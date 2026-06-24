import nextConfig from 'eslint-config-next'

// React Compiler rules were added in eslint-config-next v16. They enforce
// constraints needed by the React Compiler (React Forget), which this project
// does not use. Patterns they flag are valid React 18 idioms. Downgrade to
// warn so they surface without blocking CI until the compiler is adopted.
const REACT_COMPILER_RULES = {
  'react-hooks/set-state-in-effect': 'warn',
  'react-hooks/refs': 'warn',
  'react-hooks/immutability': 'warn',
  'react-hooks/purity': 'warn',
}

// Find the next config object that owns the react-hooks plugin so we can
// merge rule overrides into it (flat config requires plugin + rule in same object).
const reactHooksConfigIdx = nextConfig.findIndex(
  (c) => c.plugins?.['react-hooks'],
)

const mergedConfig = nextConfig.map((c, i) =>
  i === reactHooksConfigIdx
    ? { ...c, rules: { ...c.rules, ...REACT_COMPILER_RULES } }
    : c,
)

/** @type {import('eslint').Linter.Config[]} */
const config = [
  { ignores: ['.next/**', 'node_modules/**'] },
  ...mergedConfig,
]

export default config
