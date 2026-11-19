<?php
/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/

declare(strict_types=1);

namespace Humdek\SurveyJsBundle\Tests\Service;

use App\Entity\DataTable;
use App\Exception\ServiceException;
use App\Service\CMS\DataColumnService;
use App\Service\CMS\DataQuery\DataQueryEngine;
use App\Service\CMS\DataService;
use App\Service\CMS\FormFileUploadService;
use Doctrine\ORM\EntityManagerInterface;
use Humdek\SurveyJsBundle\Entity\Survey;
use Humdek\SurveyJsBundle\Service\SurveyAccessService;
use Humdek\SurveyJsBundle\Service\SurveyResponseRecord;
use Humdek\SurveyJsBundle\Service\SurveyResponseStore;
use PHPUnit\Framework\Attributes\AllowMockObjectsWithoutExpectations;
use PHPUnit\Framework\TestCase;
use Symfony\Component\HttpFoundation\File\UploadedFile;

/**
 * One response holds at most {@see SurveyResponseStore::MAX_UPLOADS} files, so
 * nobody (a guest included) can fill the disk through one survey.
 */
#[AllowMockObjectsWithoutExpectations]
final class SurveyUploadLimitTest extends TestCase
{
    public function testAResponseThatIsFullRefusesTheNextUpload(): void
    {
        $data = $this->createMock(DataService::class);
        $data->method('getDataTableByName')->willReturn($this->createMock(DataTable::class));
        $files = $this->createMock(FormFileUploadService::class);
        $files->expects(self::never())->method('storeRecordFile');

        $store = new SurveyResponseStore(
            $this->createMock(EntityManagerInterface::class),
            $data,
            $this->createMock(DataQueryEngine::class),
            $this->createMock(SurveyAccessService::class),
            $files,
            $this->createMock(DataColumnService::class),
        );
        $keys = array_map(static fn (int $n): string => 'uploads/form-files/guest/table_1/record_2/field_q/' . $n . '_aaaaaaaa_f.png', range(1, SurveyResponseStore::MAX_UPLOADS));
        $record = SurveyResponseRecord::fromRow([
            'record_id' => 2,
            'triggerType' => 'updated',
            SurveyResponseStore::COL_RESPONSE_ID => 'R_1',
            SurveyResponseStore::COL_UPLOADS => json_encode($keys, JSON_UNESCAPED_SLASHES),
        ]);
        $tmp = (string) tempnam(sys_get_temp_dir(), 'qa_');

        $this->expectException(ServiceException::class);
        $store->storeUpload(new Survey('qa', 'SV_QA1', []), $record, new UploadedFile($tmp, 'f.png', null, null, true), 'q', null);
    }
}
