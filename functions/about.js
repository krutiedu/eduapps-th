import { renderContentPage } from './_content-pages.js';

export const onRequest = context => renderContentPage(context, 'about');
