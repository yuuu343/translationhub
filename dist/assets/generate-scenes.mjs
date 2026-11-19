/** Original deterministic vector landscape artwork for translationhub.
 * No photographs, third-party artwork, model output, or external assets.
 * These source files and the generated SVGs are released under CC0-1.0.
 * Regenerate with: node assets/generate-scenes.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let seed = 19;
function random() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
function f(n) { return Number(n.toFixed(2)); }
function stars(count, color = '#e9e4ff') {
  return Array.from({length:count}, () => `<circle cx="${f(random()*2400)}" cy="${f(70+random()*450)}" r="${f(.55+random()*1.3)}" fill="${color}" opacity="${f(.14+random()*.53)}"/>`).join('');
}
function ridge(base, amp, phase) {
  const values = [];
  for (let x=-40;x<=2440;x+=20) {
    const y = base + amp * (Math.sin(x/370+phase)*.49 + Math.sin(x/131+phase)*.22 + Math.sin(x/61+phase)*.07) + random()*6;
    values.push(`${x},${f(y)}`);
  }
  return `M ${values.join(' L ')} L 2440,1240 L -40,1240 Z`;
}
const grain = `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".79" numOctaves="3" stitchTiles="stitch" seed="23"/><feColorMatrix type="saturate" values="0"/></filter>`;
function wrap(title, defs, shapes) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="2400" height="1200" viewBox="0 0 2400 1200" role="img"><title>${title}</title><defs>${grain}${defs}</defs>${shapes}<rect width="2400" height="1200" filter="url(#grain)" opacity=".045" style="mix-blend-mode:soft-light"/></svg>`;
}

seed = 1947;
const blueDefs = `
<linearGradient id="sky" x2="0" y2="1"><stop stop-color="#172448"/><stop offset=".42" stop-color="#454c88"/><stop offset=".7" stop-color="#8d79af"/><stop offset="1" stop-color="#dba8bd"/></linearGradient>
<radialGradient id="light"><stop stop-color="#f4c1cb" stop-opacity=".65"/><stop offset="1" stop-color="#c7a0cc" stop-opacity="0"/></radialGradient>
<linearGradient id="sea" x2="0" y2="1"><stop stop-color="#8c87b2"/><stop offset=".3" stop-color="#555e98"/><stop offset="1" stop-color="#172b50"/></linearGradient>
<linearGradient id="coast" x2="0" y2="1"><stop stop-color="#223957"/><stop offset="1" stop-color="#111f3d"/></linearGradient>
<linearGradient id="cloud" x2="1" y2="0"><stop stop-color="#b0a0c6" stop-opacity="0"/><stop offset=".5" stop-color="#bda7cd" stop-opacity=".35"/><stop offset="1" stop-color="#c9aecf" stop-opacity="0"/></linearGradient>
<filter id="soft"><feGaussianBlur stdDeviation="14"/></filter>`;
let blue = `<rect width="2400" height="1200" fill="url(#sky)"/>
<ellipse cx="1510" cy="560" rx="1020" ry="410" fill="url(#light)"/>
${stars(65)}
<circle cx="1759" cy="297" r="28" fill="#f4e4db" opacity=".93"/><circle cx="1770" cy="287" r="26" fill="#515487"/>
<g filter="url(#soft)"><path d="M 0 365 Q 510 285 1030 365 T 2400 355 L2400 400 Q1650 375 1010 400 T0 395Z" fill="url(#cloud)"/><path d="M 50 486 Q 720 425 1380 479 T 2400 453 L 2400 480 Q 1620 510 870 481 T 50 503 Z" fill="url(#cloud)"/></g>
<rect y="641" width="2400" height="559" fill="url(#sea)"/>
<path d="M 0 641 Q 420 632 900 640 T 2400 639" fill="none" stroke="#bca3c4" stroke-width="3" opacity=".45"/>
<path d="M0 625 Q130 602 210 595 T380 600 Q 520 614 650 646 L0 672 Z" fill="#575d8c"/>
<path d="M2400 620 Q2220 592 2120 615 T1935 648 L2400 670Z" fill="#6b6895"/>
<path d="M0 710 Q155 661 240 685 Q322 710 399 736 Q510 744 652 789 Q493 808 355 849 Q176 862 0 889Z" fill="#3c4b78"/>
<path d="M2400 711 Q2240 681 2150 723 Q2040 754 1960 784 Q1880 813 1730 835 Q1825 866 1980 865 Q2190 882 2400 952Z" fill="#35476e"/>
<path d="M0 831 Q133 798 219 828 Q326 865 462 874 Q581 889 735 952 Q635 963 556 1002 Q400 1025 300 1061 Q188 1125 0 1161Z" fill="url(#coast)"/>
<path d="M2400 854 Q2240 825 2156 883 Q2053 902 1914 955 Q1879 982 1717 1018 Q1623 1044 1547 1071 Q1720 1080 1850 1134 L1900 1200 L2400 1200 Z" fill="#142944"/>
<path d="M0 1075 Q180 1017 305 1054 Q455 1097 602 1115 L782 1200 H0Z" fill="#10213b"/>
<g fill="none" stroke-linecap="round">`;
for (let i=0;i<280;i++) {
  const y=651+random()*540, perspective=(y-640)/560, x=random()*2400;
  blue += `<path d="M${f(x)} ${f(y)} h${f(4+random()*(5+perspective*66))}" stroke="${i%4===0?'#d1b8d4':'#a2a0ca'}" opacity="${f(.035+random()*.085)}" stroke-width="${f(.5+perspective*.8)}"/>`;
}
blue += `</g>`;
writeFileSync(fileURLToPath(new URL('./blue-hour.svg', import.meta.url)), wrap('青の時間 — original coastal landscape',blueDefs,blue));

seed=3841;
const morningDefs = `
<linearGradient id="sky" x2="0" y2="1"><stop stop-color="#7b97b9"/><stop offset=".43" stop-color="#bdcbd7"/><stop offset=".78" stop-color="#f0ded1"/><stop offset="1" stop-color="#f6cfae"/></linearGradient>
<radialGradient id="glow"><stop stop-color="#fff2d9" stop-opacity=".85"/><stop offset="1" stop-color="#ffe4ca" stop-opacity="0"/></radialGradient>
<linearGradient id="front" x2="0" y2="1"><stop stop-color="#506779"/><stop offset="1" stop-color="#243e51"/></linearGradient>
<filter id="haze"><feGaussianBlur stdDeviation="22"/></filter>`;
let morning=`<rect width="2400" height="1200" fill="url(#sky)"/><ellipse cx="1550" cy="470" rx="860" ry="540" fill="url(#glow)"/><circle cx="1577" cy="434" r="47" fill="#ffefd8" opacity=".9"/>
<path d="M0 704 L120 642 L252 673 L405 536 L515 606 L679 477 L837 608 L979 544 L1143 666 L1260 612 L1395 697 L1520 640 L1680 697 L1845 591 L1964 648 L2110 566 L2265 678 L2400 637 V1200 H0Z" fill="#a9a9b7"/>
<path d="M0 761 L193 729 L372 655 L491 705 L609 660 L732 711 L883 587 L1028 729 L1153 749 L1298 707 L1452 776 L1625 715 L1796 751 L1990 646 L2124 729 L2269 705 L2400 750 V1200 H0Z" fill="#8c96a7"/>
<path d="M792 694 L883 587 L951 654 L923 641 L903 652 L887 629 L868 653 L847 647Z" fill="#e4dcd6" opacity=".6"/>
<path d="M549 566 L679 477 L755 545 L715 521 L689 529 L676 508 L644 542 L617 538Z" fill="#e5ddd9" opacity=".6"/>
<path d="${ridge(855,80,.8)}" fill="#73869a"/>
<g filter="url(#haze)" fill="#e7dbd1" opacity=".48"><path d="M0 813 Q610 836 1120 780 T2400 824 V880 Q1730 825 1130 873 T0 865Z"/><path d="M300 944 Q850 875 1500 919 T2400 890 V945 Q1790 954 1310 958 T300 975Z"/></g>
<path d="M0 876 Q190 823 394 900 T778 1030 Q985 1065 1270 1200 H0Z" fill="url(#front)"/>
<path d="M2400 824 Q2230 865 2090 946 T1690 1050 Q1480 1090 1310 1200 H2400Z" fill="#405c71"/>
<path d="M0 1080 Q330 987 580 1120 L780 1200 H0Z" fill="#253e4e"/>
<path d="M2400 1058 Q2220 1040 2050 1130 L1900 1200 H2400Z" fill="#294759"/>`;
writeFileSync(fileURLToPath(new URL('./mountain-morning.svg', import.meta.url)),wrap('山の朝 — original alpine landscape',morningDefs,morning));

seed=77113;
const forestDefs=`
<linearGradient id="sky" x2="0" y2="1"><stop stop-color="#75989b"/><stop offset=".45" stop-color="#b0c6bf"/><stop offset="1" stop-color="#e8e7ce"/></linearGradient>
<radialGradient id="glow"><stop stop-color="#f4f2d6" stop-opacity=".7"/><stop offset="1" stop-color="#c7d6c5" stop-opacity="0"/></radialGradient>
<linearGradient id="lake" x2="0" y2="1"><stop stop-color="#8faeaa"/><stop offset="1" stop-color="#3e6a70"/></linearGradient>
<filter id="mist"><feGaussianBlur stdDeviation="17"/></filter>`;
let forest=`<rect width="2400" height="1200" fill="url(#sky)"/><ellipse cx="1330" cy="440" rx="1100" ry="500" fill="url(#glow)"/>
<path d="${ridge(610,125,1.7)}" fill="#8ca8a3"/><path d="${ridge(695,108,3.8)}" fill="#74958e"/><path d="${ridge(770,65,.2)}" fill="#5b817c"/>
<g filter="url(#mist)"><path d="M0 701 Q570 770 1200 713 T2400 734 V779 Q1780 752 1200 779 T0 760Z" fill="#d6e2ce" opacity=".45"/></g>
<rect y="827" width="2400" height="373" fill="url(#lake)"/>
<path d="M0 846 Q456 813 900 847 T2400 840" stroke="#c0d0bc" stroke-width="2" fill="none" opacity=".5"/>`;
function tree(x,y,h,fill,opacity=1) {
  const w=h*.31;
  return `<path d="M${f(x)} ${f(y-h)} l${f(w*.48)} ${f(h*.32)} h${f(-w*.22)} l${f(w*.5)} ${f(h*.29)} h${f(-w*.27)} l${f(w*.52)} ${f(h*.29)} h${f(-w*.9)} v${f(h*.1)} h${f(-w*.1)} v${f(-h*.1)} h${f(-w*.85)} l${f(w*.51)} ${f(-h*.29)} h${f(-w*.28)} l${f(w*.5)} ${f(-h*.29)} h${f(-w*.2)}Z" fill="${fill}" opacity="${opacity}"/>`;
}
for(let i=0;i<240;i++){const x=random()*2400,h=22+random()*72;forest+=tree(x,840+random()*8,h,'#446f69',.65+random()*.3);}
for(let i=0;i<140;i++){const x=random()*2400,y=851+random()*345;forest+=`<path d="M${f(x)} ${f(y)} h${f(8+random()*45)}" stroke="#b0c8bd" stroke-width="1" opacity="${f(.04+random()*.13)}"/>`;}
forest+=`<path d="M0 943 Q180 880 430 976 Q590 1022 837 1116 L970 1200 H0Z" fill="#244e50"/><path d="M2400 1020 Q2230 955 2100 1020 T1720 1200 H2400Z" fill="#315e5b"/>`;
for(let i=0;i<90;i++){const x=random()*650,y=1000+x*.23+random()*130,h=70+random()*220;forest+=tree(x,y,h,i%3?'#214748':'#2c5551');}
for(let i=0;i<45;i++){const x=2050+random()*350,y=1130+random()*70,h=65+random()*125;forest+=tree(x,y,h,'#244f4c');}
forest+=`<g filter="url(#mist)"><path d="M400 907 Q1150 849 2030 902 L2130 934 Q1240 912 410 932Z" fill="#cfdbcb" opacity=".27"/></g>`;
writeFileSync(fileURLToPath(new URL('./forest-stillness.svg', import.meta.url)),wrap('森の静けさ — original forest lake landscape',forestDefs,forest));
console.log('Created 3 original CC0 landscape SVGs.');
