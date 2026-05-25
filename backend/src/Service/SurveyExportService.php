<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Service;

use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Entity\SurveyAnswerLink;
use Humdek\SurveyJsBundle\Entity\SurveyRun;
use Humdek\SurveyJsBundle\Repository\SurveyAnswerLinkRepository;
use Humdek\SurveyJsBundle\Repository\SurveyRunRepository;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Server-side CSV / XLSX / JSON exports.
 *
 * The plan calls for streaming so very large surveys do not need to
 * buffer every cell in PHP memory. CSV is hand-written (no extra
 * dependency, UTF-8 BOM + comma delimiter for Excel friendliness).
 * XLSX falls back to a single in-memory write because the streaming
 * SpreadsheetWriter requires `phpoffice/phpspreadsheet`; when that
 * package is missing we return a 501 hint so an operator can install
 * it on demand without breaking the rest of the dashboard.
 */
final class SurveyExportService
{
    public const FORMAT_CSV = 'csv';
    public const FORMAT_XLSX = 'xlsx';
    public const FORMAT_JSON = 'json';

    /**
     * Internal columns that always appear before the question columns,
     * matching the legacy Tabulator dashboard column order.
     */
    private const INTERNAL_COLUMNS = [
        'record_id',
        'response_id',
        'date',
        'id_users',
        'visitor_id',
        'page_no',
        'trigger_type',
        'status',
        'revision',
    ];

    public function __construct(
        private readonly SurveyRunRepository $runs,
        private readonly SurveyAnswerLinkRepository $answerLinks,
    ) {
    }

    public function streamCsv(Survey $survey): StreamedResponse
    {
        $columns = $this->collectQuestionColumns($survey);
        $headers = [...self::INTERNAL_COLUMNS, ...array_keys($columns)];
        $response = new StreamedResponse(function () use ($survey, $columns, $headers): void {
            $out = fopen('php://output', 'wb');
            if ($out === false) {
                return;
            }
            // UTF-8 BOM so Excel auto-detects the encoding.
            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, $headers, ',', '"', '\\');
            foreach ($this->runs->findRecentForSurvey($survey, 100000) as $run) {
                $row = $this->buildRow($run, array_keys($columns));
                fputcsv($out, $row, ',', '"', '\\');
            }
            fclose($out);
        });
        $response->headers->set('Content-Type', 'text/csv; charset=utf-8');
        $response->headers->set('Content-Disposition', sprintf(
            'attachment; filename="%s.csv"',
            $this->fileBaseName($survey),
        ));
        return $response;
    }

    public function streamJson(Survey $survey): StreamedResponse
    {
        $response = new StreamedResponse(function () use ($survey): void {
            $out = fopen('php://output', 'wb');
            if ($out === false) {
                return;
            }
            fwrite($out, '{"surveyId":' . json_encode($survey->getSurveyId()) . ',"name":' . json_encode($survey->getName()) . ',"responses":[');
            $first = true;
            foreach ($this->runs->findRecentForSurvey($survey, 100000) as $run) {
                if (!$first) {
                    fwrite($out, ',');
                }
                $first = false;
                $answers = [];
                foreach ($this->answerLinks->findForRun($run) as $link) {
                    /** @var SurveyAnswerLink $link */
                    $answers[$link->getQuestionName()] = $this->maybeDecode($link->getAnswerValue());
                }
                fwrite($out, json_encode([
                    'responseId' => $run->getResponseId(),
                    'startedAt' => $run->getStartedAt()->format(DATE_ATOM),
                    'completedAt' => $run->getCompletedAt()?->format(DATE_ATOM),
                    'status' => $run->getStatus(),
                    'idUser' => $run->getIdUser(),
                    'visitorId' => $run->getVisitorId(),
                    'revision' => $run->getVersion()->getRevision(),
                    'answers' => $answers,
                ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) ?: 'null');
            }
            fwrite($out, ']}');
            fclose($out);
        });
        $response->headers->set('Content-Type', 'application/json; charset=utf-8');
        $response->headers->set('Content-Disposition', sprintf(
            'attachment; filename="%s.json"',
            $this->fileBaseName($survey),
        ));
        return $response;
    }

    public function streamXlsx(Survey $survey): StreamedResponse
    {
        if (!class_exists('\\PhpOffice\\PhpSpreadsheet\\Spreadsheet')) {
            // Use a 501 streamed payload so the runtime can show the
            // operator a clear message without crashing.
            $response = new StreamedResponse(function (): void {
                echo json_encode([
                    'error' => 'XLSX export requires phpoffice/phpspreadsheet. Install it via `composer require phpoffice/phpspreadsheet`.',
                ]) ?: '';
            }, 501);
            $response->headers->set('Content-Type', 'application/json; charset=utf-8');
            return $response;
        }

        $columns = $this->collectQuestionColumns($survey);
        $response = new StreamedResponse(function () use ($survey, $columns): void {
            $spreadsheetCls = '\\PhpOffice\\PhpSpreadsheet\\Spreadsheet';
            $writerCls = '\\PhpOffice\\PhpSpreadsheet\\Writer\\Xlsx';
            /** @var object{getActiveSheet: callable} $spreadsheet */
            $spreadsheet = new $spreadsheetCls();
            /** @var object{setTitle: callable, setCellValueByColumnAndRow: callable} $sheet */
            $sheet = $spreadsheet->getActiveSheet();
            $sheet->setTitle('Responses');

            $col = 1;
            foreach ([...self::INTERNAL_COLUMNS, ...array_keys($columns)] as $header) {
                $sheet->setCellValueByColumnAndRow($col, 1, $header);
                $col++;
            }

            $rowIdx = 2;
            foreach ($this->runs->findRecentForSurvey($survey, 100000) as $run) {
                $values = $this->buildRow($run, array_keys($columns));
                $colIdx = 1;
                foreach ($values as $value) {
                    $sheet->setCellValueByColumnAndRow($colIdx, $rowIdx, $value);
                    $colIdx++;
                }
                $rowIdx++;
            }

            /** @var object{save: callable} $writer */
            $writer = new $writerCls($spreadsheet);
            $writer->save('php://output');
        });
        $response->headers->set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        $response->headers->set('Content-Disposition', sprintf(
            'attachment; filename="%s.xlsx"',
            $this->fileBaseName($survey),
        ));
        return $response;
    }

    /**
     * @return array<string, true>
     */
    private function collectQuestionColumns(Survey $survey): array
    {
        $cols = [];
        foreach ($this->runs->findRecentForSurvey($survey, 100000) as $run) {
            foreach ($this->answerLinks->findForRun($run) as $link) {
                $cols[$link->getQuestionName()] = true;
            }
        }
        ksort($cols);
        return $cols;
    }

    /**
     * @param array<int, string> $questionColumns
     * @return array<int, scalar|null>
     */
    private function buildRow(SurveyRun $run, array $questionColumns): array
    {
        $progress = $run->getProgress() ?? [];
        $pageNo = isset($progress['pageNo']) && is_int($progress['pageNo']) ? $progress['pageNo'] : 0;
        $triggerType = isset($progress['triggerType']) && is_string($progress['triggerType']) ? $progress['triggerType'] : 'finished';

        $row = [
            $run->getId(),
            $run->getResponseId(),
            ($run->getCompletedAt() ?? $run->getStartedAt())->format('Y-m-d H:i:s'),
            $run->getIdUser(),
            $run->getVisitorId(),
            $pageNo,
            $triggerType,
            $run->getStatus(),
            $run->getVersion()->getRevision(),
        ];
        $answers = [];
        foreach ($this->answerLinks->findForRun($run) as $link) {
            $answers[$link->getQuestionName()] = $link->getAnswerValue();
        }
        foreach ($questionColumns as $name) {
            $row[] = $answers[$name] ?? null;
        }
        return $row;
    }

    private function fileBaseName(Survey $survey): string
    {
        return sprintf('%s_%s', $survey->getSurveyId(), date('Y_m_d-H_i'));
    }

    private function maybeDecode(string $value): mixed
    {
        if ($value === '' || ($value[0] !== '{' && $value[0] !== '[')) {
            return $value;
        }
        $decoded = json_decode($value, true);
        return $decoded ?? $value;
    }
}
