const fs = require('fs');
let html = fs.readFileSync('landing.html', 'utf8');

// Extract body content
const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
if (!bodyMatch) {
  console.log('No body found');
  process.exit(1);
}
let body = bodyMatch[1];

// Extract colors from Tailwind config script
const configMatch = html.match(/"colors":\s*({[^}]+})/);
let styleTags = '';
if (configMatch) {
  try {
    const colors = JSON.parse(configMatch[1]);
    let cssVars = Object.entries(colors).map(([key, val]) => `--color-${key}: ${val};`).join('\n        ');
    styleTags = `
      <style dangerouslySetInnerHTML={{ __html: \`
      :root {
        ${cssVars}
      }
      .bg-background { background-color: var(--color-background); }
      .text-on-background { color: var(--color-on-background); }
      .bg-surface { background-color: var(--color-surface); }
      .text-on-surface { color: var(--color-on-surface); }
      .text-on-surface-variant { color: var(--color-on-surface-variant); }
      .bg-primary { background-color: var(--color-primary); }
      .text-on-primary { color: var(--color-on-primary); }
      .text-primary { color: var(--color-primary); }
      .bg-secondary { background-color: var(--color-secondary); }
      .text-on-secondary { color: var(--color-on-secondary); }
      .text-secondary { color: var(--color-secondary); }
      .bg-surface-container-low { background-color: var(--color-surface-container-low); }
      .bg-surface-container-lowest { background-color: var(--color-surface-container-lowest); }
      .bg-surface-container-high { background-color: var(--color-surface-container-high); }
      .bg-surface-container-highest { background-color: var(--color-surface-container-highest); }
      .border-surface-variant { border-color: var(--color-surface-variant); }
      .border-outline-variant { border-color: var(--color-outline-variant); }
      .text-outline { color: var(--color-outline); }
      .text-outline-variant { color: var(--color-outline-variant); }
      .bg-primary-container\\/20 { background-color: color-mix(in srgb, var(--color-primary-container) 20%, transparent); }
      .bg-secondary-container\\/20 { background-color: color-mix(in srgb, var(--color-secondary-container) 20%, transparent); }
      .bg-tertiary-container\\/20 { background-color: color-mix(in srgb, var(--color-tertiary-container) 20%, transparent); }
      .bg-secondary-fixed\\/50 { background-color: color-mix(in srgb, var(--color-secondary-fixed) 50%, transparent); }
      .text-on-secondary-fixed { color: var(--color-on-secondary-fixed); }
      \`}} />
    `;
  } catch(e) {}
}

// Strip HTML comments which break JSX
body = body.replace(/<!--[\s\S]*?-->/g, '');

// Convert class to className
body = body.replace(/class=/g, 'className=');

// Fix self closing tags (img, input, hr, br)
body = body.replace(/<img([^>]*[^\/])>/g, '<img$1 />');
body = body.replace(/<input([^>]*[^\/])>/g, '<input$1 />');

// Fix SVG attributes
body = body.replace(/viewbox=/g, 'viewBox=');
body = body.replace(/stroke-width=/g, 'strokeWidth=');
body = body.replace(/fill-opacity=/g, 'fillOpacity=');
body = body.replace(/preserveaspectratio=/g, 'preserveAspectRatio=');
body = body.replace(/style="[^"]*"/g, ''); // drop inline styles

const jsx = `
import React from 'react';
import Link from 'next/link';

export default function LandingPage() {
  return (
    <>
      ${styleTags}
      <div className="bg-background text-on-background font-body-md antialiased overflow-x-hidden selection:bg-primary-container selection:text-on-primary-container" style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-on-background)' }}>
        ${body}
      </div>
    </>
  );
}
`;

fs.writeFileSync('apps/web/src/app/(marketing)/page.tsx', jsx);
console.log('Successfully wrote page.tsx with comments removed');
