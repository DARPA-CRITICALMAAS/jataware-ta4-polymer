// https://github.com/bigskysoftware/htmx/issues/1690
import htmx from 'htmx.org';
import 'htmx.org/dist/ext/alpine-morph';
import 'htmx.org/dist/ext/json-enc';
import 'htmx.org/dist/ext/sse';
import 'htmx.org/dist/ext/response-targets';

htmx.config.useTemplateFragments = true;

window.htmx = htmx;
