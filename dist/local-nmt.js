import { sentenceRanges } from "./documents.js";
import { explicitLiteralRanges, protectLiterals } from "./text-literals.js";

export const LOCAL_TRANSLATION_INCOMPLETE = "LOCAL_TRANSLATION_INCOMPLETE";
function incomplete(message) {
  return Object.assign(new Error(message), {
    code: LOCAL_TRANSLATION_INCOMPLETE,
  });
}

// Only split at punctuation outside parentheses/quoted text. Whitespace and
// character midpoints can separate a number from its unit or a word in two.
export function clauseBoundaries(text) {
  const pairs = new Map([
    ["(", ")"],
    ["（", "）"],
    ["[", "]"],
    ["【", "】"],
    ["{", "}"],
    ["「", "」"],
    ["『", "』"],
    ["“", "”"],
    ["‘", "’"],
    ["«", "»"],
  ]);
  const stack = [],
    strong = [],
    weak = [];
  const literals = explicitLiteralRanges(text);
  let literalIndex = 0;
  for (let i = 0; i < text.length; i++) {
    if (literalIndex < literals.length && i === literals[literalIndex][0]) {
      i = literals[literalIndex++][1] - 1;
      continue;
    }
    const char = text[i];
    if (stack.at(-1) === char) {
      stack.pop();
      continue;
    }
    if (pairs.has(char)) {
      stack.push(pairs.get(char));
      continue;
    }
    if (char === '"') {
      stack.push(char);
      continue;
    }
    if (stack.length || i === text.length - 1) continue;
    // Decimal/thousands separators and clock times are never clause boundaries.
    if (/\d/.test(text[i - 1] || "") && /\d/.test(text[i + 1] || "")) continue;
    if (/[;；:：]/.test(char)) strong.push(i + 1);
    else if (/[,，、]/.test(char)) weak.push(i + 1);
  }
  return { strong, weak };
}

function longestRepeat(ids) {
  let longest = 0;
  // Only very long consecutive repetitions indicate decoding degeneration.
  // Compare with the input as well so intentional repeated source text survives.
  for (let size = 1; size <= 12; size++) {
    let run = 0;
    for (let i = size; i < ids.length; i++) {
      run = ids[i] === ids[i - size] ? run + 1 : 0;
      if (run >= size * 7) longest = Math.max(longest, run + size);
    }
  }
  return longest;
}

export function hasDecodingLoop(outputIds, inputIds) {
  const repeated = longestRepeat(outputIds);
  return repeated >= 48 && repeated > longestRepeat(inputIds) + 24;
}

export async function translateLocalText(pipe, text, source, target) {
  const configuredLimit = pipe.model.config.max_position_embeddings;
  const inputLimit = Math.min(
    512,
    Number.isFinite(configuredLimit) ? configuredLimit : 512,
  );
  const outputLimit = inputLimit - 1; // The decoder starts with one token.
  const eosValue =
    pipe.model.generation_config?.eos_token_id ??
    pipe.model.config.eos_token_id;
  const eos = new Set(
    (Array.isArray(eosValue) ? eosValue : [eosValue]).map(Number),
  );
  // Bound tokenizer work before encoding too. This is only a work/memory cap,
  // not an estimate of tokens: every resulting child is still counted exactly.
  const maxTokenizerChars = inputLimit * 8;
  async function split(value, depth, reason) {
    const { strong, weak } = clauseBoundaries(value);
    if ((!strong.length && !weak.length) || depth >= 32) {
      throw incomplete(
        reason === "input"
          ? "軽量ローカルでは、この長い文を意味のまとまりで分割できません。文を短くするか、PLaMoなど別の翻訳方式を選んでください。"
          : reason === "literal"
            ? "軽量ローカルが長い文の測定値や式を保持できませんでした。この文の訳は確定していません。文を短くするか、別の翻訳方式を選んでください。"
            : "軽量ローカルが訳文を最後まで生成できませんでした。文を短くするか、別の翻訳方式を選んでください。",
      );
    }
    // Pick an existing punctuation boundary near the middle, preferring strong
    // clauses when they are reasonably balanced. Never tokenize every prefix:
    // that costs quadratic work and retains many unnecessary Tensor buffers.
    const middle = value.length / 2;
    const centralStrong = strong.filter(
      (cut) => cut >= value.length / 4 && cut <= (value.length * 3) / 4,
    );
    const candidates = centralStrong.length
      ? centralStrong
      : [...strong, ...weak];
    const firstContent = value.length - value.trimStart().length;
    const lastContent = value.trimEnd().length;
    let best,
      distance = Infinity;
    for (const cut of candidates) {
      if (cut <= firstContent || cut >= lastContent) continue;
      const difference = Math.abs(middle - cut);
      if (difference < distance) {
        distance = difference;
        best = cut;
      }
    }
    if (best === undefined)
      throw incomplete(
        "軽量ローカルではこの文を分割できません。別の翻訳方式を選んでください。",
      );
    const left = await sentence(value.slice(0, best).trim(), depth + 1, true);
    const right = await sentence(value.slice(best).trim(), depth + 1, true);
    return left + (target === "ja" ? "" : " ") + right;
  }
  async function sentence(value, depth = 0, recovering = false) {
    if (value.length > maxTokenizerChars) return split(value, depth, "input");
    // Text2TextGenerationPipeline always truncates. Use the same Marian model
    // directly so an input limit can never silently remove the source tail.
    let inputs = await pipe.tokenizer(value, {
      padding: false,
      truncation: false,
    });
    if (inputs.input_ids.dims.at(-1) > inputLimit) {
      inputs = null;
      return split(value, depth, "input");
    }
    // A long sentence/list which exceeded the window or degenerated has already
    // failed as a unit. Keep its recovery clauses short instead of repeatedly
    // feeding near-window fragments to a compact sentence translator. An
    // indivisible clause still gets its full window; no word is forcibly cut.
    if (recovering && inputs.input_ids.dims.at(-1) > 64) {
      const cuts = clauseBoundaries(value);
      if (cuts.strong.length || cuts.weak.length) {
        inputs = null;
        return split(value, depth, "input");
      }
    }
    let output = await pipe.model.generate({
      ...inputs,
      max_new_tokens: outputLimit,
      num_beams: 1,
      do_sample: false,
      // A forced EOS at the limit conceals truncation. Require the model's own EOS.
      forced_eos_token_id: null,
    });
    const ids = Array.from(output.data, Number);
    const sourceIds = Array.from(inputs.input_ids.data, Number);
    if (!eos.has(ids.at(-1)) || hasDecodingLoop(ids, sourceIds)) {
      inputs = output = null;
      return split(value, depth, "output");
    }
    const translated = pipe.tokenizer
      .batch_decode(output, { skip_special_tokens: true })[0]
      ?.trim();
    inputs = output = null;
    if (!translated)
      throw incomplete(
        "訳文を生成できませんでした。文章を短くして再試行してください。",
      );
    // A compact model can end naturally while omitting whole measurements in
    // a recovery fragment. Reuse the narrowly scoped literal check; ordinary
    // sentences and general numbers (including currency conversion) are not
    // checked here. Do not publish a successful prefix if a later clause fails.
    if (recovering) {
      const literals = protectLiterals(value, true);
      if (literals && !literals.intact(translated))
        return split(value, depth, "literal");
    }
    return translated;
  }
  const results = [];
  // Share the app's abbreviation-aware boundaries; a second raw Intl pass would
  // split repaired sentences such as "Dr. Chen ..." back into fragments.
  for (const [start, end] of sentenceRanges(text, source)) {
    results.push(await sentence(text.slice(start, end)));
  }
  return results.join(target === "ja" ? "" : " ");
}
