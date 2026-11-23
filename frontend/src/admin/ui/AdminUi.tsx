/*
SPDX-FileCopyrightText: 2026 Humdek, University of Bern
SPDX-License-Identifier: MPL-2.0
*/
/**
 * The host admin's shared look (page header, filter buttons, modal, empty
 * state), rebuilt
 * with the same Mantine props. A plugin cannot import the host's components
 * (only `@selfhelp/shared/plugin-sdk`), so these mirror `PageHeader`,
 * `FilterActions`, `ModalWrapper` and `EmptyState` in the host frontend; keep them in step
 * when those change.
 */

import { Badge, Box, Button, Center, CloseButton, Group, Modal, Stack, Text, Title } from '@mantine/core';
import { IconRefresh, IconRestore } from '@tabler/icons-react';
import type { ReactNode } from 'react';

interface IPageHeaderProps {
    title: string;
    subtitle?: string;
    badge?: number;
    badgeAriaLabel?: string;
    children?: ReactNode;
}

export function PageHeader({ title, subtitle, badge, badgeAriaLabel, children }: IPageHeaderProps): React.ReactElement {
    return (
        <Group justify="space-between" align="center" wrap="wrap" gap="lg">
            <Box>
                <Group gap={8} align="center">
                    <Title order={1} size="h2">{title}</Title>
                    {badge !== undefined && (
                        <Badge variant="light" color="blue" size="lg" radius="xl" aria-label={`${badge} ${badgeAriaLabel ?? title}`}>
                            {badge}
                        </Badge>
                    )}
                </Group>
                {subtitle && (
                    <Text size="sm" c="dimmed" mt={4}>
                        {subtitle}
                    </Text>
                )}
            </Box>
            {children && (
                <Group gap="sm" align="center">
                    {children}
                </Group>
            )}
        </Group>
    );
}

export function EmptyState({ title, description }: { title: string; description: ReactNode }): React.ReactElement {
    return (
        <Center py="sm">
            <Stack align="center" gap="sm">
                <Text size="lg" c="dimmed" fw={500}>{title}</Text>
                <Text size="sm" c="dimmed" ta="center">{description}</Text>
            </Stack>
        </Center>
    );
}

interface IAdminModalProps {
    opened: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    size?: string;
    onSave?: () => void;
    onDelete?: () => void;
    saveLabel?: string;
    deleteLabel?: string;
    cancelLabel?: string;
    isLoading?: boolean;
    disabled?: boolean;
}

/** The host's `ModalWrapper`: header and footer bars, delete on the left, cancel and save on the right. */
export function AdminModal({
    opened,
    onClose,
    title,
    children,
    size = 'lg',
    onSave,
    onDelete,
    saveLabel = 'Save',
    deleteLabel = 'Delete',
    cancelLabel = 'Cancel',
    isLoading = false,
    disabled = false,
}: IAdminModalProps): React.ReactElement {
    return (
        <Modal
            opened={opened}
            onClose={onClose}
            size={size}
            centered
            closeOnClickOutside={false}
            withCloseButton={false}
            classNames={{ content: 'sjs-admin-modal', body: 'sjs-admin-modal__body' }}
            aria-label={title}
        >
            <Group justify="space-between" align="center" p="md" className="sjs-admin-modal__bar sjs-admin-modal__bar--top">
                <Text size="lg" fw={600}>{title}</Text>
                <CloseButton onClick={onClose} aria-label="Close" />
            </Group>
            <Box p="md">{children}</Box>
            <Group justify="space-between" align="center" p="md" className="sjs-admin-modal__bar sjs-admin-modal__bar--bottom">
                <Group>
                    {onDelete && (
                        <Button variant="light" color="red" onClick={onDelete} loading={isLoading} disabled={disabled} size="sm">
                            {deleteLabel}
                        </Button>
                    )}
                </Group>
                <Group>
                    <Button variant="outline" onClick={onClose} disabled={isLoading} size="sm">
                        {cancelLabel}
                    </Button>
                    {onSave && (
                        <Button onClick={onSave} loading={isLoading} disabled={disabled} size="sm">
                            {saveLabel}
                        </Button>
                    )}
                </Group>
            </Group>
        </Modal>
    );
}

interface IFilterActionsProps {
    onApply: () => void;
    onReset: () => void;
    onRefresh: () => void;
    isFetching: boolean;
    isApplyDisabled?: boolean;
}

/** The filter card's buttons, as on the host's list screens: apply, reset, refresh. */
export function FilterActions({ onApply, onReset, onRefresh, isFetching, isApplyDisabled = false }: IFilterActionsProps): React.ReactElement {
    return (
        <Group gap="sm" justify="flex-end" wrap="nowrap">
            <Button variant="filled" color="blue" onClick={onApply} loading={isFetching} disabled={isApplyDisabled}>
                Apply Filters
            </Button>
            <Button leftSection={<IconRestore size={16} />} color="gray" onClick={onReset} loading={isFetching}>
                Reset
            </Button>
            <Button variant="light" leftSection={<IconRefresh size={16} />} onClick={onRefresh} loading={isFetching} disabled={isFetching}>
                Refresh
            </Button>
        </Group>
    );
}
