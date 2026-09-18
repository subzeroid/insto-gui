import { setLocale } from './i18n'

// The default locale in tests is English: it is fixed before any component mounts,
// so a test that switches it has to restore `en` itself.
setLocale('en')
