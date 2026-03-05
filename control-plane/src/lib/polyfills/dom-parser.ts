/**
 * DOMParser and DOM Node polyfills for Cloudflare Workers
 *
 * AWS SDK v3.894.0+ uses DOMParser for XML parsing in browser environments.
 * Cloudflare Workers is detected as a browser environment but doesn't provide DOMParser
 * or DOM Node constants. This polyfill bridges that gap using @xmldom/xmldom.
 *
 * Related issues:
 * - https://github.com/aws/aws-sdk-js-v3/pull/7347
 * - https://github.com/aws/aws-sdk-js-v3/issues/7375
 * - https://github.com/cloudflare/workers-sdk/issues/10755
 */

import { DOMParser as XMLDOMParser } from '@xmldom/xmldom';

/**
 * Polyfill Node constants in the global scope for AWS SDK XML parser compatibility
 *
 * The AWS SDK browser XML parser (xml-parser.browser.js) references Node.ELEMENT_NODE,
 * Node.TEXT_NODE, etc., which are not available in Cloudflare Workers.
 */
export function installNodePolyfill() {
  if (typeof Node === 'undefined') {
    // @ts-ignore - Adding to global scope
    globalThis.Node = {
      ELEMENT_NODE: 1,
      ATTRIBUTE_NODE: 2,
      TEXT_NODE: 3,
      CDATA_SECTION_NODE: 4,
      ENTITY_REFERENCE_NODE: 5,
      ENTITY_NODE: 6,
      PROCESSING_INSTRUCTION_NODE: 7,
      COMMENT_NODE: 8,
      DOCUMENT_NODE: 9,
      DOCUMENT_TYPE_NODE: 10,
      DOCUMENT_FRAGMENT_NODE: 11,
      NOTATION_NODE: 12
    };

    console.log('[Polyfill] Node constants installed for Cloudflare Workers compatibility');
  }
}

/**
 * Polyfill DOMParser in the global scope for AWS SDK compatibility
 */
export function installDOMParserPolyfill() {
  // Only install if DOMParser is not already available
  if (typeof DOMParser === 'undefined') {
    // @ts-ignore - Adding to global scope
    globalThis.DOMParser = class DOMParser {
      constructor() {
        this.parser = new XMLDOMParser({
          // Configure error handler to match browser behavior
          errorHandler: {
            warning: () => {},
            error: (msg: string) => console.error('[DOMParser]', msg),
            fatalError: (msg: string) => { throw new Error(msg); }
          }
        });
      }

      private parser: XMLDOMParser;

      /**
       * Parse XML/HTML string into a Document
       * @param source - XML/HTML string to parse
       * @param mimeType - MIME type (text/xml, text/html, application/xml, etc.)
       */
      parseFromString(source: string, mimeType: string): Document {
        try {
          // Use xmldom parser
          const doc = this.parser.parseFromString(source, mimeType);

          // Cast to Document type for compatibility
          return doc as unknown as Document;
        } catch (error) {
          console.error('[DOMParser] Parse error:', error);
          throw error;
        }
      }
    };

    console.log('[Polyfill] DOMParser installed for Cloudflare Workers compatibility');
  }
}

/**
 * Install all required polyfills for AWS SDK compatibility in Cloudflare Workers
 *
 * This function should be called before any AWS SDK imports to ensure
 * all required globals are available.
 */
export function installAWSPolyfills() {
  installNodePolyfill();
  installDOMParserPolyfill();
}
