/**
 * TranslationHub Apps Script connector — MIT License.
 * 1. Create a standalone Apps Script at https://script.google.com/.
 * 2. Paste this file. In Project Settings > Script Properties add
 *    TRANSLATIONHUB_SECRET with a long random value (at least 32 characters).
 * 3. Deploy > New deployment > Web app; execute as yourself; allow Anyone.
 *    This uses YOUR account's LanguageApp quota. Share the secret with nobody.
 * 4. Paste the /exec URL and secret into TranslationHub. Do not log inputs.
 * No Spreadsheet, Drive, Properties, or Cache writes occur during translation.
 * Google processes translation text. This does not bypass Google's quotas.
 */
function doPost(e) {
  try {
    const expected = PropertiesService.getScriptProperties().getProperty('TRANSLATIONHUB_SECRET');
    if (!expected || expected.length < 32) return respond_({error: 'Set a strong TRANSLATIONHUB_SECRET in Script Properties.'});
    const data = JSON.parse(e.postData.contents);
    if (typeof data.secret !== 'string' || !constantEqual_(data.secret, expected)) return respond_({error: 'Invalid connection secret.'});
    if (typeof data.text !== 'string' || data.text.length > 30000) return respond_({error: 'Text must be shorter than 30,000 characters.'});
    const source = data.source === 'auto' ? '' : String(data.source || '');
    const target = String(data.target || 'ja');
    if (!/^[a-z]{0,3}(?:-[A-Za-z]{2,4})?$/.test(source) || !/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(target)) return respond_({error: 'Invalid language code.'});
    return respond_({translation: LanguageApp.translate(data.text, source, target)});
  } catch (error) {
    // Do not log or echo the source text or secret, even on an error.
    return respond_({error: 'Translation failed. Check LanguageApp quota and language codes.'});
  }
}
function constantEqual_(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) diff |= (a.charCodeAt(i) || 0) ^ b.charCodeAt(i);
  return diff === 0;
}
function respond_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
