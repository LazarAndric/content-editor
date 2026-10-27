import createDOMPurify from 'dompurify';
import { Marked } from 'marked';

import {richTextMarker} from './compatibility.mjs';
export {richTextMarker};
const tags = ['p','div','br','span','strong','b','em','i','u','s','del','strike','sub','sup',
  'ul','ol','li','a','blockquote','pre','code','hr','h1','h2','h3','h4','h5','h6',
  'table','thead','tbody','tfoot','tr','th','td','caption','colgroup','col'];
const styles = new Set(['color','background-color','font-family','font-size','font-weight','font-style',
  'text-decoration','text-decoration-line','text-align','line-height','vertical-align',
  'margin-left','margin-right','padding-left','padding-right','list-style-type',
  'border','border-collapse','border-width','border-style','border-color','width','height']);
const escapeHtml = text => String(text).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const markdown = new Marked({breaks:true,gfm:true});
markdown.use({renderer:{html:token => escapeHtml(token.text)}});

export function createContentFormatter(window) {
  const purifier = createDOMPurify(window);
  function sanitize(html) {
    const fragment = purifier.sanitize(String(html), {
      ALLOWED_TAGS:tags, ALLOWED_ATTR:['style','href','title','target','rel','colspan','rowspan','start','reversed','scope','dir'],
      ALLOW_DATA_ATTR:false, RETURN_DOM_FRAGMENT:true,
    });
    for (const element of fragment.querySelectorAll('*')) {
      const cleanStyle = window.document.createElement('span').style;
      for (const property of Array.from(element.style)) {
        const value = element.style.getPropertyValue(property);
        if (styles.has(property) && !/url\s*\(|expression\s*\(|[\\<>@]/i.test(value)) cleanStyle.setProperty(property,value,'');
      }
      if (cleanStyle.cssText) element.setAttribute('style',cleanStyle.cssText);
      else element.removeAttribute('style');
      if (element.tagName === 'A') {
        const href = element.getAttribute('href') || '';
        if (!/^(?:https?:|mailto:|tel:|#|\/(?!\/))/i.test(href)) element.removeAttribute('href');
        element.setAttribute('target','_blank'); element.setAttribute('rel','noopener noreferrer');
      }
    }
    const container = window.document.createElement('div'); container.append(fragment);
    return container.innerHTML;
  }
  function html(value) {
    const source = String(value ?? '');
    if (source.startsWith(richTextMarker)) return sanitize(source.slice(richTextMarker.length));
    // Markdown is supported for paste/import; literal HTML in old text stays literal.
    return sanitize(markdown.parse(source));
  }
  function store(source) {
    const safe = sanitize(source), container = window.document.createElement('div');
    container.innerHTML = safe;
    return container.textContent.replace(/\u00a0/g,' ').trim() || container.querySelector('hr,table')
      ? richTextMarker + safe : '';
  }
  return {html,store,sanitize};
}
let formatter;
const current = () => formatter ||= createContentFormatter(window);
export const contentHtml = value => current().html(value);
export const storeContentHtml = html => current().store(html);
export const sanitizeContentHtml = html => current().sanitize(html);
