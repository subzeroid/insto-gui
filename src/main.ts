import { createApp } from 'vue'
import App from './App.vue'
import type { Invoke } from './desktop/client'
import { currentLocale, detectLocale, savedLocale, setLocale } from './i18n'
import './style.css'

// English unless Settings saved another language. The locale is chosen once, before anything renders: `t` reads it directly, so a
// change after mount would leave already-rendered copy behind.
setLocale(detectLocale(savedLocale(), window.location.search, import.meta.env.DEV))
document.documentElement.lang = currentLocale()

const mount = (invokeCommand?: Invoke) => createApp(App, invokeCommand === undefined ? {} : { invokeCommand }).mount('#app')

// `?mock=1` in a development server replaces the Tauri bridge with an in-process
// fake, so the UI can be opened in a plain browser for UI work and screenshots.
// The import is dynamic and guarded by `import.meta.env.DEV`, so no demo data can
// reach a release bundle.
if (import.meta.env.DEV && new URLSearchParams(window.location.search).get('mock') === '1') {
  const setup = new URLSearchParams(window.location.search).get('setup') === '1'
  void import('./desktop/mock').then(({ createMockInvoke }) => mount(createMockInvoke({ setup })))
} else mount()
