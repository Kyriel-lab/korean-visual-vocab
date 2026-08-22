KOREAN VISUAL VOCABULARY — V1.1
GitHub Pages + PWA edition

FILES TO UPLOAD TO YOUR EXISTING GITHUB REPO:
- index.html
- styles.css
- app.js
- sw.js
- manifest.webmanifest
- icon-192.png
- icon-512.png
- favicon.png

HOW TO UPDATE YOUR EXISTING GITHUB PAGES SITE:
1. Open your existing repository on GitHub.
2. Choose Add file → Upload files.
3. Drag ALL files above into the repository root.
4. GitHub will replace index.html/styles.css/app.js/sw.js/manifest.webmanifest.
5. Commit changes.
6. Wait about 1–3 minutes and reopen the GitHub Pages URL.
7. Hard refresh once: Ctrl + Shift + R.

PWA:
- Open the GitHub Pages URL in Chrome or Edge.
- After the service worker and manifest are detected, an Install app button may appear in the website header.
- Chrome/Edge may also show an install icon in the address bar.
- Once installed, the site opens in its own app window.
- Core app files are cached for offline use.

DATA:
- Vocabulary remains stored in IndexedDB in the browser/device.
- Installing the PWA does NOT sync data between laptop and phone.
- Export JSON backups regularly.
- Do not clear the browser/site storage unless you have a backup.

GITHUB PAGES:
All file paths are relative (./), so this build is safe to host in a repository subpath such as:
https://USERNAME.github.io/korean-visual-vocab/
