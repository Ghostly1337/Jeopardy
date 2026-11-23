// Startseite: Raumcode eingeben und zur Spielerseite wechseln
document.getElementById('joinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const code = document.getElementById('code').value.trim().toUpperCase();
  if (code) location.href = 'player.html?room=' + encodeURIComponent(code);
});
