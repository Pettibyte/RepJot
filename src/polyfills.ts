// Svelte 5 uses replaceAll while creating DOM templates. Silk 80 does not expose it.
import 'core-js/actual/string/replace-all';

import { installRandomUuidPolyfill } from './random-uuid';

installRandomUuidPolyfill();
