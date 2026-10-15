// The picture for a trophy not yet earned (hidden or not), after the PS3's: a glassy tile with a big trophy cup cut off
// on the right and a padlock in front, its keyhole cut through. PS3 themes have no icon of their own for it (it's the
// system's), so it's the same whatever the theme.
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
<defs>
<linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d0d0d0" stop-opacity=".62"/><stop offset=".5" stop-color="#a8a8a8" stop-opacity=".55"/><stop offset="1" stop-color="#8a8a8a" stop-opacity=".6"/></linearGradient>
<linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".45" stop-color="#fff" stop-opacity=".12"/><stop offset=".46" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fafafa"/><stop offset=".6" stop-color="#dedede"/><stop offset="1" stop-color="#b4b4b4"/></linearGradient>
<linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fdfdfd"/><stop offset="1" stop-color="#cfcfcf"/></linearGradient>
<linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".6" stop-color="#ececec"/><stop offset="1" stop-color="#c4c4c4"/></linearGradient>
<filter id="d" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="2.5" stdDeviation="2.5" flood-color="#000" flood-opacity=".35"/></filter>
<clipPath id="k"><rect width="128" height="128" rx="11"/></clipPath>
<mask id="h"><rect width="128" height="128" fill="#fff"/><circle cx="66" cy="68" r="9"/><path d="M66 70 75.5 92h-19Z"/></mask>
</defs>
<rect width="128" height="128" rx="11" fill="url(#t)"/>
<path clip-path="url(#k)" fill-rule="evenodd" fill="url(#c)" opacity=".92" d="M64 -2C51 7 43 18 43 30C43 47 51 59 62 65C74 72 89 76 101 78L109 104H91L86 128H130V-2ZM81 12C72 16 67 22 68 29C69 40 80 48 95 52L83.5 12Z"/>
<rect width="128" height="128" rx="11" fill="url(#g)"/>
<rect x=".75" y=".75" width="126.5" height="126.5" rx="10.25" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.5"/>
<g opacity=".72" mask="url(#h)"><g filter="url(#d)">
<path d="M41 51V37a25 25 0 0 1 50 0v14H77V37a11 11 0 0 0-22 0v14Z" fill="url(#s)"/>
<rect x="25" y="49" width="82" height="54" rx="5" fill="url(#b)"/>
</g></g>
</svg>`;

export const LOCKED_TROPHY = `data:image/svg+xml,${encodeURIComponent(SVG)}`;
