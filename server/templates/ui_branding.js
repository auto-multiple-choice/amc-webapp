/*
 * Branding for the sign-in pages, which belong to the separate sign-in
 * service: the school name, logo and colours, from the app's public,
 * read-only branding (/public/branding.json). Served by server/ui.py.
 */
(function () {
  fetch('/public/branding.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (b) {
      if (!b) return;
      var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      var p = b.palette && b.palette[dark ? 'dark' : 'light'];
      if (p) {
        document.documentElement.style.setProperty('--accent', p.brand);
        document.documentElement.style.setProperty('--accent-text', p.on_brand);
      }
      var brand = document.querySelector('.brand');
      if (brand && (b.name || b.logo)) {
        brand.textContent = '';
        if (b.logo) {
          var img = document.createElement('img');
          img.src = b.logo;
          img.alt = '';
          brand.appendChild(img);
        }
        brand.appendChild(document.createTextNode(b.name || 'AMC'));
      }
      if (b.name) document.title = document.title.replace(/AMC$/, b.name);
    })
    .catch(function () { /* stays neutral */ });
})();
