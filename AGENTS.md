# Project styling

- Author style changes only in SCSS source files under `css/scss`, using the existing folder structure and main stylesheet imports.
- Follow neighboring stylesheets: nested selectors, tab indentation, shared color variables, existing typography and border/shadow mixins, and section comments.
- Reuse existing component styles where practical; keep group-check overrides in `css/scss/_setup/group-check.scss`.
- Do not hand-edit or append rules to compiled CSS or source maps. Let the configured Sass build generate them.
