---
name: react-testing-library
description: "React Testing Library guide with Vitest, carrying the DevDigest client/ conventions where they differ from the general advice. Use when writing, reviewing, or setting up React component and hook tests. Covers RTL query priority, the interaction API this repo actually installs, async patterns, mocking strategies scoped per package, and common anti-patterns."
---

# React Testing Library

Guide for testing React components and hooks with React Testing Library (RTL) and Vitest. The RTL
fundamentals here — query priority, async handling, the anti-pattern catalog — hold anywhere. The
passages marked **DevDigest** record what this repository actually installs and does; inside this
repo they win over the general advice.

## Philosophy: Fewer Tests, Real Scenarios

> "Write tests. Not too many. Mostly integration." — Kent C. Dodds

1. **Use-case coverage > code coverage** — aim for 100% use-case coverage, not 100% line coverage. Think about what the user can DO, not what the code does internally.
2. **Write fewer, longer tests** — one test that walks through a full user flow beats six isolated assertions. Combine related steps (render → interact → verify) into a single test.
3. **Test behavior, not implementation** — assert on what the user sees and can do. Never assert on internal state, hook calls, or DOM structure.
4. **Mock at boundaries only** — mock API calls and external services. Never mock your own components, hooks, or context internals.
5. **Each test must justify its existence** — if removing a test wouldn't reduce your confidence that the app works, delete it.

### The Testing Trophy (what to invest in)

```
    E2E        ← Few: critical user journeys only
  Integration  ← MOST tests: components with real providers, mocked data hooks
  Unit         ← Some: complex pure logic, utilities, formatters
Static Analysis ← Always: TypeScript
```

The static-analysis layer is **`tsc` alone** in DevDigest. There is no ESLint, Biome or Prettier
anywhere in the repo and no `lint` script — that is deliberate, root `CLAUDE.md` § Conventions
forbids adding one, and `lint-tooling-introduced` is a CRITICAL check in the PR gate. Reach for
`corepack pnpm typecheck`, never for a linter.

The E2E layer is neither Playwright nor Cypress: `e2e/` drives the external agent-browser CLI over
declarative `specs/NN-name.flow.json` files. See `e2e/CLAUDE.md`; it is out of this skill's scope.

---

## Setup from Scratch

### 1. Dependencies — never install one

**Never run a package manager to add a testing dependency.** A missing dependency is a blocker to
report, not a problem to solve: name the package, name the directory that would need it, say what
the approach would have been, and stop. Which test stack a package uses is not the test author's
call, and a package manager invoked in the wrong directory is destructive in this repo.

A complete RTL + Vitest stack is `vitest`, `@testing-library/react`, `@testing-library/jest-dom`
and `jsdom`, with `@testing-library/user-event`, `msw` and `@vitest/coverage-v8` as optional
extras.

**DevDigest** already has the four required ones in `client/package.json` and deliberately has
none of the three optional ones. Write tests against what is installed; steps 2–4 below are
already done in `client/vitest.config.ts` and `client/src/test/setup.ts`.

### 2. Vitest Config

Create `vitest.config.js` at the client root (or extend `vite.config.js`):

```js
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    css: true,
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
  },
}));
```

### 3. Setup File

Create `src/test/setup.js`:

```js
import '@testing-library/jest-dom/vitest';
```

This registers matchers like `toBeInTheDocument()`, `toBeVisible()`, `toHaveTextContent()`.

### 4. Package Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

---

## Test Scenarios by Component Type

Before writing tests, identify the component type and pick scenarios from this matrix. Write **1-3 tests per component** — each test covers a full user flow, not a single assertion.

### Form Component (e.g., BlogEditor, LoginForm, CommentForm)

| # | Test | What it covers |
|---|------|----------------|
| 1 | **Happy path: fill all fields → submit → success feedback** | Rendering, typing, validation passing, API call, success state |
| 2 | **Validation: submit empty/invalid → error messages appear** | Required fields, validation rules, error rendering |
| 3 | **API failure: fill valid → submit → server error shown** | Error handling, error UI, form stays filled |

### List/Table Component (e.g., BlogList, CommentList, Dashboard)

| # | Test | What it covers |
|---|------|----------------|
| 1 | **Happy path: data loads → items render → user interacts** | Loading state, data rendering, click/navigation |
| 2 | **Empty state: no data → empty message shown** | Zero-data handling |
| 3 | **Error state: API fails → error message shown** | Network failure handling |

### Detail/View Component (e.g., BlogDetail, UserProfile)

| # | Test | What it covers |
|---|------|----------------|
| 1 | **Happy path: data loads → full content renders → user actions work** | Data fetching, rendering, interactions (edit/delete/comment) |
| 2 | **Not found / error: invalid ID → appropriate message** | 404 handling, error boundaries |

### Auth-Gated Component (e.g., AdminPanel, ProtectedRoute)

| # | Test | What it covers |
|---|------|----------------|
| 1 | **Authenticated: user sees protected content and can interact** | Auth context, content rendering, user actions |
| 2 | **Unauthenticated: redirects or shows login prompt** | Guard behavior, redirect |

### Shared/Presentational Component (e.g., BlogCard, Button, Modal)

| # | Test | What it covers |
|---|------|----------------|
| 1 | **Renders with props and handles user interaction** | Props → UI mapping, click/hover callbacks |
| 2 | **Conditional rendering: different props → different output** | Only if the component has meaningful branching |

---

## Complete Spec Template

This is what a well-structured test file looks like. Each test walks through a real user flow.

```jsx
// BlogList.test.jsx
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

// --- Fixture: a small factory local to this file.
// Each client test file carries its own (see `finding()` in PRRow.test.tsx); promoting one
// to a shared directory is a decision to announce, not a convenience to take.
const blogs = [
  { id: '1', title: 'First Post', category: 'Technology', excerpt: 'About tech' },
  { id: '2', title: 'Second Post', category: 'Startup', excerpt: 'About startups' },
];

// --- The seam is the data hook, not the network. No MSW, no fetch stub.
let listing = { data: blogs, isLoading: false, error: null };
vi.mock('@/lib/hooks/blogs', () => ({ useBlogs: () => listing }));

// Imported after the fixture and the mock, the way PRRow.test.tsx and RunStatus.test.tsx do it —
// see the note on factory timing under Mocking Strategies.
import BlogList from './BlogList';

afterEach(() => {
  cleanup();
  listing = { data: blogs, isLoading: false, error: null };
});

// --- Tests: 3 tests covering ALL real scenarios ---
describe('BlogList', () => {
  it('lists blogs and lets the user open one', () => {
    render(<BlogList />);

    expect(screen.getByText('First Post')).toBeInTheDocument();
    expect(screen.getByText('Second Post')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: /first post/i }));
    // Assert navigation on a mocked next/navigation router spy — count first, see below.
  });

  it('shows the empty state when there are no blogs', () => {
    listing = { data: [], isLoading: false, error: null };
    render(<BlogList />);

    expect(screen.getByText(/no blogs/i)).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('shows an error message when the query fails', () => {
    listing = { data: undefined, isLoading: false, error: new Error('Server error') };
    render(<BlogList />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});
```

A hook returning its fixture synchronously removes the loading state from the test, which is why
these three cases need no `await`. When the component is instead driven through a real
`QueryClientProvider` — the shape used by the few tests that stub `fetch` — the data does arrive
asynchronously and the `findBy*` queries in **Async Testing** apply.

**DevDigest** wraps only in the providers the component actually needs, in the order
`QueryClientProvider > NextIntlClientProvider > ToastProvider`, and imports its i18n messages by a
relative path whose depth is counted from the test file (`SkillCard.test.tsx` counts the segments
in a comment rather than copying a sibling's path). `pnpm typecheck`, not `pnpm test`, is what names
a wrong depth.

### Form Spec Template

```jsx
// LoginForm.test.jsx
let login = { mutate: vi.fn(), isPending: false, error: null };
vi.mock('@/lib/hooks/auth', () => ({ useLogin: () => login }));

import LoginForm from './LoginForm';

afterEach(() => {
  cleanup();
  login = { mutate: vi.fn(), isPending: false, error: null };
});

describe('LoginForm', () => {
  it('submits valid credentials', () => {
    render(<LoginForm />);

    // fireEvent.change REPLACES the value — there is no incremental typing.
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'admin@test.com' } });
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    // Count FIRST: toHaveBeenCalledWith alone passes if *any* call matched, so a stray
    // second submit would go unseen. (client/insights.md, on the PRRow router spy.)
    expect(login.mutate).toHaveBeenCalledTimes(1);
    expect(login.mutate).toHaveBeenCalledWith({
      email: 'admin@test.com',
      password: 'password123',
    });
  });

  it('shows validation errors when submitted empty', async () => {
    render(<LoginForm />);

    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

    // Both fields show errors
    expect(await screen.findByText(/email is required/i)).toBeInTheDocument();
    expect(screen.getByText(/password is required/i)).toBeInTheDocument();

    // And nothing was submitted
    expect(login.mutate).not.toHaveBeenCalled();
  });

  it('shows the server error the hook reports', () => {
    login = { mutate: vi.fn(), isPending: false, error: new Error('Invalid credentials') };
    render(<LoginForm />);

    expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
  });
});
```

---

## Import Rules

```js
// Test runner — ALWAYS from vitest
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// RTL — render, screen, waitFor, cleanup, and the interaction API
import { render, screen, waitFor, within, fireEvent, cleanup } from '@testing-library/react';

// Hook testing
import { renderHook, act } from '@testing-library/react';
```

NEVER import from `jest`. Use `vi.fn()`, `vi.spyOn()`, `vi.mock()`.

Interaction comes from `@testing-library/react` here, not from a separate package — see
**Interaction** below for why, and never add an import for a package this repo does not have.

---

## Query Priority

Queries are ordered by how closely they reflect user experience.

### Tier 1 — Accessible (default choice)

| Query | Use For |
|-------|---------|
| `getByRole` | Buttons, links, headings, inputs, checkboxes, comboboxes — **always try first** |
| `getByLabelText` | Form fields with a `<label>` |
| `getByPlaceholderText` | Inputs without a label (prefer adding a label instead) |
| `getByText` | Static text content — paragraphs, spans, error messages |
| `getByDisplayValue` | Input with a current value |

### Tier 2 — Semantic

| Query | Use For |
|-------|---------|
| `getByAltText` | Images |
| `getByTitle` | Elements with `title` attribute |

### Tier 3 — Last resort

| Query | Use For |
|-------|---------|
| `getByTestId` | Only when no accessible query works; requires `data-testid` |

### Query Variants

| Variant | Returns | Use When |
|---------|---------|----------|
| `getBy` | Element or throws | Element **must** be present |
| `queryBy` | Element or `null` | Asserting element does **not** exist |
| `findBy` | Promise\<Element\> | Element appears **after** an async operation |
| `*AllBy` | Array variants | Multiple matching elements |

### Role Query Patterns

```
getByRole('button', { name: /submit/i })
getByRole('heading', { level: 2 })
getByRole('textbox', { name: /email/i })
getByRole('link', { name: /read more/i })
getByRole('checkbox', { name: /agree/i })
getByRole('combobox')              // <select>
getByRole('status')                // role="status"
getByRole('alert')                 // role="alert"
getByRole('dialog')                // <dialog> or role="dialog"
getByRole('navigation')            // <nav>
```

---

## Interaction — `fireEvent` (`userEvent` is not installed here)

Where `@testing-library/user-event` is a dependency, prefer it — it dispatches the whole sequence
of events a real user produces (pointer, focus, keyboard) instead of a single synthetic event, so
it catches handlers a bare `click` never reaches. That preference assumes the package is present;
`userEvent` is not installed in DevDigest.

**The evidence, so this is not taken on trust:** `@testing-library/user-event` is absent from both
the `dependencies` and the `devDependencies` block of `client/package.json`, and `userEvent` is not
installed here nor referenced anywhere under `client/src`. All 13 client test files that simulate
interaction import `fireEvent` from `@testing-library/react`. So `fireEvent` is the house tool: it
is the correct choice here, not a tolerated one, and adding the package to "fix" it is not an
option (see **Dependencies** above).

`fireEvent` is synchronous — no `setup()`, and no `await` on the call itself.

| Method | Purpose |
|--------|---------|
| `fireEvent.click(el)` | Click |
| `fireEvent.dblClick(el)` | Double-click |
| `fireEvent.change(el, { target: { value: 'text' } })` | Set an input's value (replaces it) |
| `fireEvent.keyDown(el, { key: 'Enter' })` | Press a key — also `ArrowDown`, `ArrowUp`, `Escape` |
| `fireEvent.submit(form)` | Submit a form directly |
| `fireEvent.focus(el)` / `fireEvent.blur(el)` | Focus and blur |
| `fireEvent.mouseEnter(el)` / `fireEvent.mouseLeave(el)` | Hover |

Pattern:
```js
render(<Component />);
fireEvent.click(screen.getByRole('button', { name: /save/i }));
```

Three consequences of the synchronous, single-event API, all visible in the client suite:

- **No incremental typing.** `fireEvent.change` sets the final value in one shot. Assert on that
  value, never on a keystroke sequence.
- **One event, not a sequence.** A component that only responds to a full interaction needs the
  individual events fired in order — `SkillsTab.test.tsx` fires `keyDown` with `ArrowDown` /
  `ArrowUp` directly to exercise keyboard reordering.
- **Nothing is awaited for you.** State that settles outside React's batching still needs `act(...)`
  or a `findBy*` query; `PRRow.test.tsx` imports `act` from RTL for exactly that.

---

## Async Testing

### `findBy` — element appears after async work

```js
render(<BlogList />);
expect(await screen.findByText('Blog Title')).toBeInTheDocument();
```

### `waitFor` — multiple assertions, complex conditions

```js
await waitFor(() => {
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
});
```

### `waitForElementToBeRemoved` — element disappears

```js
render(<BlogList />);
await waitForElementToBeRemoved(() => screen.queryByText('Loading...'));
```

### Rules

- **Never** use `setTimeout` or fixed delays
- **Never** use `act()` directly unless testing hooks outside components — RTL wraps it
- `findBy` is preferred over `waitFor` + `getBy` for single-element waits
- `waitFor` retries until the callback passes or times out (default 1000ms)

---

## Component Testing Patterns

### Basic render + interaction

```
1. Arrange — render the component with props/providers
2. Act — simulate user interaction via fireEvent
3. Assert — check what the user would see
```

Combine all three into a single test when they form one user flow. Don't split Arrange/Act/Assert into separate `it()` blocks.

### Render helper

Create a local `renderComponent` function when the component needs providers:

```js
const renderComponent = (props = {}) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <MyComponent defaultProp="value" {...props} />
    </NextIntlClientProvider>
  );
```

Wrap in **only** the providers the component actually needs. The DevDigest stack, outermost first,
is `QueryClientProvider` → `NextIntlClientProvider` → `ToastProvider`; a component that reads no
translations needs none of them.

### Asserting absence

```js
// queryBy returns null — safe with .not
expect(screen.queryByText('Error')).not.toBeInTheDocument();
```

### Scoping queries with `within`

```js
const card = screen.getByRole('article');
expect(within(card).getByText('Title')).toBeInTheDocument();
```

---

## Hook Testing

Use `renderHook` for hooks with **complex pure logic** only. If a hook just fetches data or manages simple state, test it through the component that uses it instead.

```js
import { renderHook, act } from '@testing-library/react';

const { result } = renderHook(() => useCounter());
act(() => result.current.increment());
expect(result.current.count).toBe(1);
```

For hooks needing providers, pass a `wrapper`:

```js
renderHook(() => useAuth(), {
  wrapper: ({ children }) => <AuthProvider>{children}</AuthProvider>,
});
```

---

## Routing — mock `next/navigation`, there is no router to wrap

`react-router` is not a dependency of this client (`grep router client/package.json` returns
nothing). DevDigest is Next App Router, so a component using `useRouter`, `usePathname`,
`useSearchParams` or `useParams` is **not** wrapped in a provider — the navigation module is
mocked, and the spy is what you assert against.

```js
// Hoisted above the component import, because vi.mock is hoisted.
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

afterEach(() => push.mockReset());
```

Then assert the count **before** the arguments:

```js
expect(push).toHaveBeenCalledTimes(1);
expect(push).toHaveBeenCalledWith('/repos/1/pulls/482');
```

`toHaveBeenCalledWith` alone passes when *any* call matches, so a second bubbled navigation goes
unseen and the test stays green. That is not hypothetical — it shipped a bug once, and the rule is
recorded in `client/insights.md` § *Codebase Patterns*.

For `<Link>`, nothing is needed: it renders as an anchor in jsdom.

---

## Mocking Strategies

### Mock the data hook — the default for data-fetching components

**DevDigest has no MSW.** `msw` is in neither dependency block of `client/package.json`, and no
component calls `fetch` directly: every server call goes through a hook in `client/src/lib/hooks/`
built on `client/src/lib/api.ts` (`client/CLAUDE.md` § Conventions). That hook is therefore the
seam — mock it, not the network.

```jsx
// PRRow fetches findings lazily for the peek panel; mock the hook rather than
// standing up a QueryClientProvider (same idiom as RunTraceDrawer.test.tsx).
vi.mock('@/lib/hooks/reviews', () => ({
  usePrReviews: () => ({ data: REVIEWS, isLoading: false }),
}));

import { PRRow } from './PRRow';
```

- Mock the hook module — never Axios, never `fetch`, never the component under test.
- The factory must return **every** export the component imports from that module, or the import
  throws.
- `vi.mock` is hoisted above the imports, but its factory runs when the mocked module is first
  imported. When the factory closes over a local fixture, the component's own import has to come
  after that fixture is defined — which is why `PRRow.test.tsx` imports `./PRRow` below its
  `REVIEWS` array rather than at the top.
- Either path form resolves: the `@/` alias (`PRRow.test.tsx`) or a counted relative path
  (`'../../../../../../../lib/hooks/reviews'` in the deeper `[number]/_components/*` tests). The
  alias works under Vitest because `client/vitest.config.ts` re-declares it — tsconfig paths alone
  would not be enough.
- Reset shared spies in `afterEach`: `push.mockReset()`, or `vi.clearAllMocks()`.

### Stubbing `fetch` — the exception, not the pattern

`vi.stubGlobal("fetch", fetchMock)` appears in exactly **three** client test files —
`ConventionsView.test.tsx`, `ImportSkillDrawer.test.tsx` and `CreateSkillModal.test.tsx` — and each
one is there because the assertion is about the *request* (its URL, method or JSON body) rather
than about rendered data. Use it only for that, and have the stub throw on any URL the test did not
expect. For everything else, mock the hook.

### MSW — not available here

MSW intercepts at the network layer and is the most realistic option in projects that install it.
Do not reach for it in DevDigest, and **do not install it** — a missing dependency is a blocker to
report, per **Dependencies** above. The hook mock is the local equivalent.

### `vi.mock` — scoped by package

`vi.mock` is not a universal fallback in this repo. Which package you are in decides whether it is
the idiom or a forbidden shortcut.

| Package | `vi.mock` | The seam to use |
|---|---|---|
| `client/` | **Idiomatic.** Used across the suite for `next/navigation` and `src/lib/hooks/*`. | the module mock itself |
| `server/`, `reviewer-core/` | **Banned.** | `buildApp({ overrides })` / `ContainerOverrides` (`server/src/platform/container.ts`) with fakes from `server/src/adapters/mocks.ts`; drive HTTP through `app.inject()` |

On the client side: reset in `beforeEach`/`afterEach` with `vi.clearAllMocks()`, and use
`vi.mocked(fn)` for type-safe access to mock methods.

The server-side ban and its replacement are owned by
[`onion-architecture`](../onion-architecture/SKILL.md) § Test seams. Read it before writing any
`server/` or `reviewer-core/` test; do not restate or reinterpret it from here.

### Context mocking

Wrap component in a test provider with controlled values. Don't mock context internals — render with the real provider.

### Timers

```js
vi.useFakeTimers();
// ... render and trigger timer-dependent code
vi.advanceTimersByTime(3000);
vi.useRealTimers(); // restore in afterEach
```

---

## What to Test / What to Skip

**Test (as user-visible flows):**
- User journeys: form fill → submit → feedback
- Data display: loading → loaded → interaction
- State transitions: empty → filled, logged out → logged in
- Error boundaries: API failure → error message
- Conditional UI: different user roles see different things

**Skip:**
- Internal state (`useState` values)
- Implementation details (hook calls, private functions)
- CSS classes or inline styles
- Third-party library internals
- Render counts or performance
- Snapshot tests (unless explicitly requested)
- Constants or static data
- Individual assertions that belong inside a longer flow test

---

## jest-dom Matchers Reference

| Matcher | Checks |
|---------|--------|
| `toBeInTheDocument()` | Element is in the DOM |
| `toBeVisible()` | Element is visible to the user |
| `toBeEnabled()` / `toBeDisabled()` | Enabled/disabled state |
| `toHaveTextContent(/text/i)` | Contains text |
| `toHaveValue('val')` | Input/select current value |
| `toHaveAttribute('href', '/path')` | HTML attribute |
| `toBeChecked()` | Checkbox/radio is checked |
| `toHaveFocus()` | Element has focus |
| `toBeRequired()` | Input is required |
| `toHaveClass('cls')` | Has CSS class (use sparingly) |
| `toHaveAccessibleDescription()` | `aria-describedby` text |
| `toBeEmptyDOMElement()` | No visible content |

---

## Test File Conventions

- Place tests next to source: `BlogCard.jsx` -> `BlogCard.test.jsx`
- Use `.test.jsx` extension (not `.spec.jsx`)
- One `describe` per component/hook
- Test names describe user-visible behavior: `"user fills form and sees success message"`
- Use `vi.fn()` for all mock functions
- Drive interaction with `fireEvent`; `@testing-library/user-event` is not installed in DevDigest
- Call `afterEach(cleanup)` explicitly, and reset any spy in the same hook — every client test file
  here does, and a test that renders twice in one `it()` calls `cleanup()` between the renders
- Always use `screen` — never destructure from `render()`
- **1-3 tests per component** (user flows), 1-2 per hook, 2-3 per utility

---

## Anti-Patterns

| Anti-Pattern | Fix |
|-------------|-----|
| Many tiny tests with one assertion each | Combine into fewer flow tests that walk through a user journey |
| Destructuring from `render()` | Use `screen.getByRole(...)` |
| `getByTestId` as first choice | Try `getByRole`, `getByLabelText`, `getByText` first |
| Testing `useState` / hook internals | Test the rendered output instead |
| `setTimeout` / fixed delays | Use `findBy` or `waitFor` |
| Snapshot tests replacing behavior tests | Write explicit assertions |
| `container.querySelector()` | Use RTL queries |
| Shared mutable state between tests | Reset in `beforeEach` |
| Importing from `jest` | Import from `vitest` (`vi.fn()`, `vi.mock()`) |
| Mocking what you're testing | Mock dependencies, not the subject |
| `act()` wrapping RTL calls | RTL handles `act()` internally |
| Mocking `fetch` when the component reads a data hook | Mock the hook in `client/src/lib/hooks/` instead |
| `vi.mock` in a `server/` or `reviewer-core/` test | Substitute at the container seam — `onion-architecture` § Test seams |
| Installing a package a test seems to need | Report the missing dependency as a blocker and stop |
| Testing every prop combination | Test the meaningful user-facing differences only |
