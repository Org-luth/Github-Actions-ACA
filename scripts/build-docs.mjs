import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import MarkdownIt from 'markdown-it';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('README.md', root), 'utf8');
const english = source.split('## English\n')[1]?.split('## Deutsch\n')[0];
const german = source.split('## Deutsch\n')[1];
if (!english || !german) throw new Error('README must contain English and Deutsch sections');
const markdown = new MarkdownIt({ html: false, linkify: true });
const output = new URL('docs/_site/', root);
mkdirSync(output, { recursive: true });
copyFileSync(new URL('docs/style.css', root), new URL('style.css', output));
writeFileSync(new URL('index.html', output), `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Ephemeral organization GitHub Actions runner image for Azure Container Apps Jobs. English and German documentation.">
  <title>GitHub Actions ACA Runner</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <a class="skip-link" href="#english">Skip to documentation</a>
  <header>
    <a class="brand" href="https://github.com/Org-luth/Github-Actions-ACA">
      <img src="https://github.com/Org-luth.png?size=96" width="40" height="40" alt="Org-luth">
      <span>Org-luth / ACA Runner</span>
    </a>
    <nav aria-label="Documentation navigation">
      <a href="#english" lang="en">English</a>
      <a href="#deutsch" lang="de">Deutsch</a>
      <a href="https://github.com/Org-luth/Github-Actions-ACA">GitHub</a>
    </nav>
  </header>
  <main>
    <div class="title-row">
      <h1>GitHub Actions ACA Runner</h1>
      <p>Ubuntu 24.04 &middot; linux/amd64 &middot; Organization scope</p>
    </div>
    <section id="english" lang="en" aria-labelledby="english-title">
      <h2 id="english-title">English</h2>
      ${markdown.render(english)}
    </section>
    <section id="deutsch" lang="de" aria-labelledby="deutsch-title">
      <h2 id="deutsch-title">Deutsch</h2>
      ${markdown.render(german)}
    </section>
  </main>
  <footer>Org-luth &middot; <a href="https://github.com/Org-luth/Github-Actions-ACA/releases">Release history</a></footer>
</body>
</html>\n`);
console.log('Documentation built in docs/_site');