<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

/**
 * Server-side sanitization of HTML answers coming from the rich-text
 * question type (Tiptap). Strips disallowed tags, attributes, and
 * inline event handlers before the value is persisted into
 * `data_cells`.
 *
 * The strategy is intentionally conservative: anything that is not in
 * the allow-list is removed. A future iteration may rely on
 * `ezyang/htmlpurifier`; for now we use PHP's DOMDocument so the
 * plugin avoids pulling a large dependency.
 */
final class SurveyJsHtmlSanitizer
{
    private const ALLOWED_TAGS = [
        'p',
        'br',
        'strong',
        'em',
        'u',
        'b',
        'i',
        'ul',
        'ol',
        'li',
        'blockquote',
        'h2',
        'h3',
        'h4',
        'a',
        'code',
        'pre',
        'span',
    ];

    private const ALLOWED_ATTRS = [
        'a' => ['href', 'title', 'target', 'rel'],
        'span' => ['data-lang'],
    ];

    public function sanitize(string $html): string
    {
        if (trim($html) === '') {
            return '';
        }

        $doc = new \DOMDocument('1.0', 'UTF-8');
        $previous = libxml_use_internal_errors(true);

        // Wrap in a known root so DOMDocument keeps multiple top-level
        // nodes (we strip the wrapper before returning).
        $wrapped = '<?xml encoding="utf-8" ?><root>' . $html . '</root>';
        $loaded = $doc->loadHTML(
            $wrapped,
            LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD | LIBXML_NONET,
        );
        libxml_clear_errors();
        libxml_use_internal_errors($previous);

        if (!$loaded) {
            return '';
        }

        $root = $doc->getElementsByTagName('root')->item(0);
        if (!$root instanceof \DOMElement) {
            return '';
        }

        $this->cleanNode($root);

        $out = '';
        foreach ($root->childNodes as $child) {
            $out .= $doc->saveHTML($child) ?: '';
        }
        return $out;
    }

    private function cleanNode(\DOMNode $node): void
    {
        if (!$node->hasChildNodes()) {
            return;
        }

        $children = iterator_to_array($node->childNodes);
        foreach ($children as $child) {
            if ($child instanceof \DOMElement) {
                $name = strtolower($child->nodeName);
                if (!in_array($name, self::ALLOWED_TAGS, true)) {
                    while ($child->firstChild instanceof \DOMNode) {
                        $node->insertBefore($child->firstChild, $child);
                    }
                    $node->removeChild($child);
                    continue;
                }
                $allowedAttrs = self::ALLOWED_ATTRS[$name] ?? [];
                $attrs = iterator_to_array($child->attributes ?? []);
                foreach ($attrs as $attr) {
                    /** @var \DOMAttr $attr */
                    $attrName = strtolower($attr->nodeName);
                    if (!in_array($attrName, $allowedAttrs, true)) {
                        $child->removeAttribute($attrName);
                    }
                }

                if ($name === 'a') {
                    $href = $child->getAttribute('href');
                    if ($href !== '' && !preg_match('#^(https?:|mailto:|tel:|/)#i', $href)) {
                        $child->removeAttribute('href');
                    }
                    if ($child->getAttribute('target') === '_blank') {
                        $rel = $child->getAttribute('rel');
                        if (!str_contains($rel, 'noopener')) {
                            $child->setAttribute('rel', trim($rel . ' noopener noreferrer'));
                        }
                    }
                }

                $this->cleanNode($child);
            } elseif ($child instanceof \DOMComment) {
                $node->removeChild($child);
            }
        }
    }
}
