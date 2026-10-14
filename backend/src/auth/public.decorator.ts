import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'isPublic';
/** Marks a route (or a whole controller) as reachable without a token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
