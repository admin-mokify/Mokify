# Mokify

Landing page for **Mokify**, a peer learning platform where students help each other study. Schools adopt the platform; it's always free for students.

## Stack

Static site, no build step: plain HTML, CSS, and vanilla JavaScript.

## Project structure

```
index.html          Landing page
assets/css/         Styles (style.css)
assets/js/          Behavior (main.js) — mobile nav, scroll reveals, the "how it works" scrolly section
assets/img/         Logo and photography used on the site
```

## Running locally

No build tools required — just serve the folder statically, e.g.:

```bash
npx http-server -p 5500 -c-1 .
```

Then open `http://localhost:5500`. This matches the `mokify-static` launch configuration in `.claude/launch.json`.
