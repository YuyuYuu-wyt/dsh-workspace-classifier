# Contributing

Thanks for taking a look at `dsh-workspace-classifier`.

## Before you start

- Read the native-UI design principle in the README. The plugin intentionally **does not replace** the native sidebar; changes should preserve native session rows and their behaviors.
- The plugin has no build step. `lib/index.js` is the host half and `lib/client.js` is the web client overlay.
- Keep the code dependency-free unless there is a strong reason to add one.

## Development workflow

1. Clone the repository and link it to a **test** DSH profile:

   ```bash
   dsh plugin --profile <test-profile> add "link:$PWD"
   ```

2. Make a change, then run:

   ```bash
   npm run check
   ```

3. Refresh the test DSH window and verify:
   - native workspace/session rows still behave normally;
   - category and date modes still render;
   - the header toggle can disable the overlay cleanly;
   - no console errors.

## Pull requests

- Keep each pull request focused on one feature or bug.
- Describe what you observed before and after the change.
- If the change affects screenshots or docs, use **fictional workspace names and paths** only.
- Do not add personal data, local absolute paths, logs, tokens or real workspace screenshots.

## Reporting bugs

Please include:

- DSH version and profile (`desktop` / `web`);
- operating system;
- steps to reproduce;
- expected vs. actual behavior;
- any browser console errors (redact local paths and workspace names).

## License

By contributing you agree that your contributions are licensed under the MIT License.
