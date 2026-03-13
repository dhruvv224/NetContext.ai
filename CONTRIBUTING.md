# Contributing to NetContext.ai

Thank you for considering contributing to NetContext.ai! We welcome all contributions — bug fixes, new features, documentation improvements, and more.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How to Contribute](#how-to-contribute)
- [Branching Strategy](#branching-strategy)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)
- [Development Setup](#development-setup)

---

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md). We are committed to providing a welcoming and inclusive environment for all contributors.

---

## How to Contribute

1. **Fork** the repository on GitHub.
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/NetContext.ai.git
   cd NetContext.ai
   ```
3. **Create a branch** for your changes (see [Branching Strategy](#branching-strategy)).
4. Make your changes, commit them with a clear message, and push to your fork.
5. **Open a Pull Request** against the `main` branch.

> ⚠️ **Direct pushes to `main` are not allowed.** All changes must go through a Pull Request and be reviewed before merging.

---

## Branching Strategy

Use descriptive branch names following this convention:

| Type         | Pattern                        | Example                          |
|--------------|--------------------------------|----------------------------------|
| Feature      | `feature/<short-description>`  | `feature/filter-by-method`       |
| Bug fix      | `fix/<short-description>`      | `fix/header-display-crash`       |
| Documentation| `docs/<short-description>`     | `docs/update-readme`             |
| Refactoring  | `refactor/<short-description>` | `refactor/background-worker`     |

---

## Submitting a Pull Request

1. Ensure your branch is up to date with `main`:
   ```bash
   git fetch origin
   git rebase origin/main
   ```
2. Push your branch to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
3. Go to the [repository on GitHub](https://github.com/dhruvv224/NetContext.ai) and click **"Compare & pull request"**.
4. Fill in the Pull Request template:
   - Describe **what** you changed and **why**.
   - Link any related issues using `Closes #<issue-number>`.
5. Wait for a maintainer to review your PR. Address any requested changes.
6. Once approved, a maintainer will merge your PR.

---

## Reporting Bugs

Open a [Bug Report](https://github.com/dhruvv224/NetContext.ai/issues/new?template=bug_report.yml) and include:

- Steps to reproduce the issue.
- Expected vs. actual behavior.
- Your Chrome version and OS.
- Any relevant console errors or screenshots.

---

## Requesting Features

Open a [Feature Request](https://github.com/dhruvv224/NetContext.ai/issues/new?template=feature_request.yml) and describe:

- The problem you are trying to solve.
- Your proposed solution.
- Any alternatives you considered.

---

## Development Setup

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the repository folder.
4. Open any web page, press **F12** / **⌥⌘I** to open DevTools, and click the **"NetContext"** tab.

When you make changes to the extension files, click the **reload icon** on the extension card in `chrome://extensions` to pick up your changes.

---

Thank you for helping make NetContext.ai better! 🎉
