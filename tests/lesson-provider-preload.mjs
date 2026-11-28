// Loaded only by the disposable test server. Production has no test-mode switch.
import { registerHooks } from 'node:module';
import { join } from 'node:path';

process.env.LEARNING_GOOGLE_WORKSPACE_FILE = join(process.env.DATA_DIR, 'workspace.json');
const author = new URL('./lesson-author-fixture.mjs', import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === './preparation-review.js' && context.parentURL?.includes('/build/server/chunks/')) {
      return { url: author, shortCircuit: true };
    }
    return next(specifier, context);
  },
});

const original = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname.endsWith('.googleapis.com')) {
    return original(process.env.LESSON_PROVIDER_URL + '/' + url.hostname + url.pathname + url.search, init);
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw Error('Unexpected external fetch in lesson test');
  return original(input, init);
};
