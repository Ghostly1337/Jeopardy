// Farbschema sofort setzen (vor dem ersten Zeichnen), damit nichts aufblitzt.
try { document.documentElement.dataset.theme = localStorage.getItem('jeopardy.theme') || 'graphit'; } catch (e) {}
