// QR-Code als SVG, komplett offline (vendor/qrcode.js, MIT) – kein externer Dienst sieht den Link.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../vendor/qrcode.js'));
  else root.JQR = factory(root.qrcode);
})(typeof self !== 'undefined' ? self : this, function (qrcode) {
  const QUIET = 4; // Pflicht-Ruhezone in Modulen

  // Matrix der dunklen Module (Fehlerkorrektur M, Version automatisch)
  function matrix(text) {
    if (!/^[\x20-\x7e]*$/.test(text)) throw new Error('QR: nur ASCII-Text (URL muss kodiert sein)');
    const qr = qrcode(0, 'M');
    qr.addData(text, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
  }

  // Immer schwarz auf weiß, damit jede Kamera ihn liest – egal welches Farbschema aktiv ist.
  // Das SVG besteht nur aus Zahlen und festen Attributen, der Link-Text selbst steht nicht darin.
  function svg(text) {
    const m = matrix(text);
    const size = m.length + QUIET * 2;
    let d = '';
    m.forEach((row, r) => row.forEach((dark, c) => { if (dark) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`; }));
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR-Code zum Beitrittslink">` +
      `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  return { matrix, svg, QUIET };
});
