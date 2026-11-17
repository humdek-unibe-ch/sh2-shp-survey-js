<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Humdek\SurveyJsBundle\Entity\Survey;
use Symfony\Component\HttpFoundation\Response;

/**
 * PDF export of a single survey response.
 *
 * The legacy plugin used `jspdf` client-side. The new plugin renders
 * server-side so admins always get the same audit-grade output
 * regardless of the operator's browser.
 *
 * Implementation strategy:
 *   - if the host has `dompdf/dompdf` installed we render the
 *     response with that library and stream `application/pdf`;
 *   - otherwise we fall back to a print-friendly HTML page (with a
 *     `Content-Disposition: inline; filename="*.html"` header) and a
 *     header banner that tells the operator to use the browser's
 *     "Print to PDF" feature. That keeps the endpoint useful even
 *     when the operator hasn't installed the optional dependency.
 *
 * Both branches share the same HTML template (`buildHtml`) so the
 * rendered output is identical between operators.
 */
final class SurveyPdfService
{
    public function __construct(private readonly SurveyJsHtmlSanitizer $sanitizer)
    {
    }

    public function renderResponse(Survey $survey, SurveyResponseRecord $record): Response
    {
        $html = $this->buildHtml($survey, $record);
        $filenameBase = sprintf(
            '%s_%s_%s',
            $survey->getSurveyId(),
            $record->responseId,
            date('Y_m_d-H_i'),
        );

        if (class_exists('\\Dompdf\\Dompdf')) {
            return $this->renderWithDompdf($html, $filenameBase);
        }
        return $this->renderHtmlFallback($html, $filenameBase);
    }

    private function buildHtml(Survey $survey, SurveyResponseRecord $record): string
    {
        $answers = '';
        foreach ($record->answers as $questionName => $value) {
            $answers .= sprintf(
                '<tr><th style="text-align:left;padding:6px;border:1px solid #ddd;background:#f4f4f4;width:35%%;">%s</th>'
                . '<td style="padding:6px;border:1px solid #ddd;">%s</td></tr>',
                htmlspecialchars($questionName, ENT_QUOTES | ENT_HTML5),
                $this->formatValue($value),
            );
        }
        $saved = $record->lastChangedAt?->format('Y-m-d H:i:s') ?? '—';
        $state = $record->isFinished() ? 'Submitted' : 'Last saved (not submitted)';
        $user = htmlspecialchars($record->userName ?? ($record->userId !== null ? sprintf('user #%d', $record->userId) : 'guest'), ENT_QUOTES | ENT_HTML5);
        $name = htmlspecialchars($survey->getName(), ENT_QUOTES | ENT_HTML5);
        $responseId = htmlspecialchars($record->responseId, ENT_QUOTES | ENT_HTML5);
        $revision = $record->revision ?? '—';

        return <<<HTML
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>{$name} · {$responseId}</title>
<style>
    body { font-family: Helvetica, Arial, sans-serif; color: #222; margin: 24px; }
    h1 { font-size: 18px; margin-bottom: 4px; }
    h2 { font-size: 14px; margin: 12px 0 4px; }
    .meta { color: #555; font-size: 12px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { vertical-align: top; }
    @media print { body { margin: 12mm; } }
</style></head><body>
<h1>{$name}</h1>
<div class="meta">
    Survey ID: <code>{$survey->getSurveyId()}</code> ·
    Revision: v{$revision} ·
    Response: <code>{$responseId}</code>
</div>
<div class="meta">
    {$state}: {$saved} · By: {$user}
</div>
<h2>Answers</h2>
<table>
{$answers}
</table>
</body></html>
HTML;
    }

    /** An answer as the store returns it: text, or a decoded JSON answer. */
    private function formatValue(mixed $value): string
    {
        if (is_array($value)) {
            $pretty = json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            return '<pre style="white-space:pre-wrap;font-family:monospace;font-size:11px;">'
                . htmlspecialchars((string) $pretty, ENT_QUOTES | ENT_HTML5)
                . '</pre>';
        }
        $value = is_scalar($value) ? (string) $value : '';
        if ($value === '') {
            return '<em style="color:#888;">empty</em>';
        }
        // Any answer may hold markup (a guest can type it), so it is cleaned,
        // never printed raw: the HTML fallback is served as a page.
        if ($this->looksLikeHtml($value)) {
            return $this->sanitizer->sanitize($value);
        }
        return nl2br(htmlspecialchars($value, ENT_QUOTES | ENT_HTML5));
    }

    private function looksLikeHtml(string $value): bool
    {
        return preg_match('/<\\w+[^>]*>/', $value) === 1;
    }

    private function renderWithDompdf(string $html, string $filenameBase): Response
    {
        $dompdfCls = '\\Dompdf\\Dompdf';
        /** @var object{loadHtml: callable, setPaper: callable, render: callable, output: callable} $dompdf */
        $dompdf = new $dompdfCls();
        $dompdf->loadHtml($html);
        $dompdf->setPaper('A4');
        $dompdf->render();
        $output = (string) $dompdf->output();
        return new Response($output, Response::HTTP_OK, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => sprintf('attachment; filename="%s.pdf"', $filenameBase),
        ]);
    }

    private function renderHtmlFallback(string $html, string $filenameBase): Response
    {
        $banner = '<div style="background:#fff8c5;border:1px solid #f0d000;padding:8px;margin-bottom:16px;font-size:12px;">'
            . 'Install <code>dompdf/dompdf</code> via composer to get a real PDF download.'
            . ' For now, use your browser&apos;s <em>Print &rarr; Save as PDF</em>.</div>';
        $withBanner = preg_replace('/<body[^>]*>/', '$0' . $banner, $html, 1) ?? $html;
        return new Response($withBanner, Response::HTTP_OK, [
            'Content-Type' => 'text/html; charset=utf-8',
            'Content-Disposition' => sprintf('inline; filename="%s.html"', $filenameBase),
        ]);
    }
}
