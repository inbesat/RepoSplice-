import { helper } from './helper';
import { aliased } from '@app/aliased';
import { pkg } from 'fake-pkg';

export * from './reexport';

export const combined = helper + aliased + pkg;
