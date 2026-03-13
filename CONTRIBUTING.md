# Contributing to Orchestr

Thank you for your interest in contributing to Orchestr! We welcome contributions from the community. This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful, inclusive, and constructive in all interactions with other contributors and maintainers.

## Getting Started

### Prerequisites

- Node.js >= 22.0.0
- npm or preferred package manager
- TypeScript knowledge

### Setup Development Environment

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/your-username/orchestr.git
   cd orchestr
   ```
3. Add upstream remote:
   ```bash
   git remote add upstream https://github.com/orchestr-sh/orchestr.git
   ```
4. Install dependencies:
   ```bash
   npm install
   ```

## Development Workflow

### Building

Build the TypeScript code:
```bash
npm run build
```

### Testing

Run the test suite:
```bash
npm test          # Run tests once
npm run test:watch  # Watch mode
npm run test:coverage  # With coverage report
```

### Linting & Formatting

The project uses **oxlint** and **Prettier** for code quality. Run before committing:
```bash
npm run lint      # Lint and auto-fix
npm run format    # Format code
```

Validate without changes:
```bash
npm run test:lint  # Check linting
npm run format:check  # Check formatting
```

### Type Checking

Verify TypeScript types:
```bash
npm run test:types
```

## Making Changes

### Create a Branch

Create a feature or fix branch from `main`:
```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

Use descriptive branch names (e.g., `feature/queue-batching`, `fix/cache-expiry`).

### Write Code

- Follow the existing code style and patterns
- Use TypeScript with proper type annotations
- Keep changes focused and atomic
- Add tests for new functionality
- Update documentation if needed

### Commit Guidelines

Write clear, concise commit messages:

- Use present tense: "Add feature" not "Added feature"
- Be descriptive: "feat: add job batching to queue system" not "update"
- Be in the format `<type>[scope?][!]: Add job batching to queue system`
- Start with a conventional commit type from the allowed type list
- Breaking changes should include `!` after the allowed commit type e.g. `fix!:`

Example:
```
feat: add queue job batching

- Implement PendingBatch class for grouped job execution
- Add batch callback support (then/catch/finally)
- Include integration tests for batch workflows
```

#### Revert

If the commit reverts a previous commit, it should begin with `revert: `, followed by the header of the reverted commit. In the body it should say: `This reverts commit <hash>.`, where the hash is the SHA of the commit being reverted.

#### Type

The type must be one of the following:

| Type         | Description                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| **build**    | Changes that affect the build system or external dependencies (example scopes: gulp, broccoli, npm)         |
| **chore**    | Routine maintenance tasks that do not directly impact the functionality of the application                  |
| **ci**       | Changes to our CI configuration files and scripts (example scopes: Travis, Circle, BrowserStack, SauceLabs) |
| **docs**     | Documentation only changes                                                                                  |
| **feat**     | A new feature                                                                                               |
| **fix**      | A bug fix                                                                                                   |
| **perf**     | A code change that improves performance                                                                     |
| **refactor** | A code change that neither fixes a bug nor adds a feature                                                   |
| **style**    | Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)      |
| **test**     | Adding missing tests or correcting existing tests                                                           |

### Git Hooks
This project uses **husky** to automatically perform tasks during the git hook events.

#### Pre-commit
- **lint-staged** to automatically lint and format staged files. Ensure your code passes these checks before committing.

#### Commit-msg
- **commitlint** to automatically check your commit messages follow our CONTRIBUTING guidelines around conventional commits.

## Testing

### Writing Tests

- Place tests in the tests directory
- Use descriptive test names
- Test both success and failure paths
- Keep tests focused and independent

Example structure:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';

describe('MyFeature', () => {
  beforeEach(() => {
    // Setup
  });

  it('should do something', () => {
    // Test code
    expect(result).toBe(expected);
  });

  it('should handle error cases', () => {
    // Error test
    expect(() => {
      // code that throws
    }).toThrow();
  });
});
```

## Pull Request Process

1. **Update your branch** with latest upstream changes:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Push to your fork**:
   ```bash
   git push origin your-branch-name
   ```

3. **Create a Pull Request** on GitHub with:
   - Clear title describing the change
   - Description explaining what and why
   - Reference any related issues (#123)
   - Screenshots or examples if applicable

4. **PR Description Template**:
   ```
   ## Description
   Brief description of changes.

   ## Related Issues
   Closes #123

   ## Type of Change
   - [ ] Bug fix (non-breaking)
   - [ ] New feature (non-breaking)
   - [ ] Breaking change
   - [ ] Documentation update

   ## Testing
   - [ ] Tests pass locally
   - [ ] Added/updated tests
   - [ ] Linting passes

   ## Checklist
   - [ ] Code follows style guidelines
   - [ ] Comments added for complex logic
   - [ ] Documentation updated
   - [ ] No new warnings generated
   ```

5. **Review Process**:
   - Address feedback promptly
   - Request re-review after making changes
   - Discuss disagreements respectfully
   - All checks must pass (tests, linting, type checking)

## Architecture & Patterns

Orchestr follows Laravel's architecture patterns. Familiarize yourself with:

- **Service Providers**: Extend `ServiceProvider`, implement `register()` and `boot()`
- **Managers**: Connection managers using the manager pattern (DatabaseManager, QueueManager, CacheManager)
- **Facades**: Static interfaces via `Facade` base class using Proxy forwarding
- **Commands**: Extend `Command` with `signature`, `description`, `handle()`
- **Events**: System event dispatcher with listeners and subscribers

See README.md and docs/ for detailed patterns.

## Documentation

- Update README.md for user-facing changes
- Add inline comments for complex logic
- Document public APIs with JSDoc
- Update docs/ folder if adding major features

## Reporting Issues

### Bug Reports

Include:
- Node.js and npm versions
- Orchestr version
- Minimal reproduction code
- Expected vs actual behavior
- Relevant error messages

### Feature Requests

Include:
- Clear use case and motivation
- Proposed API/interface
- Examples of how it would be used
- Any alternatives considered

## Questions?

- Check existing issues and discussions
- Ask in pull request comments
- Open a GitHub discussion for questions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

Thank you for helping make Orchestr better! 🎉
