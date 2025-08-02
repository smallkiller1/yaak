import type {
  Folder,
  GrpcRequest,
  HttpRequest,
  WebsocketRequest,
  Workspace,
} from '@yaakapp-internal/models';
import { getAnyModel, patchModelById } from '@yaakapp-internal/models';
import classNames from 'classnames';
import { useAtom, useAtomValue } from 'jotai';
import type { MouseEvent } from 'react';
import React, { useCallback, useRef, useState } from 'react';
import { useDrop } from 'react-dnd';
import { useKey, useKeyPressEvent } from 'react-use';
import { activeRequestIdAtom } from '../../hooks/useActiveRequestId';
import { activeWorkspaceAtom } from '../../hooks/useActiveWorkspace';
import { useCreateDropdownItems } from '../../hooks/useCreateDropdownItems';
import { useHotKey } from '../../hooks/useHotKey';
import { useSidebarHidden } from '../../hooks/useSidebarHidden';
import { getSidebarCollapsedMap } from '../../hooks/useSidebarItemCollapsed';
import { deleteModelWithConfirm } from '../../lib/deleteModelWithConfirm';
import { jotaiStore } from '../../lib/jotai';
import { router } from '../../lib/router';
import { setWorkspaceSearchParams } from '../../lib/setWorkspaceSearchParams';
import { ContextMenu } from '../core/Dropdown';
import { GitDropdown } from '../GitDropdown';
import type { DragItem } from './dnd';
import { ItemTypes } from './dnd';
import { sidebarSelectedIdsAtom, sidebarTreeAtom } from './SidebarAtoms';
import type { SidebarItemProps } from './SidebarItem';
import { SidebarItems } from './SidebarItems';

interface Props {
  className?: string;
}

export type SidebarModel = Folder | GrpcRequest | HttpRequest | WebsocketRequest | Workspace;

export interface SidebarTreeNode {
  id: string;
  name: string;
  model: SidebarModel['model'];
  sortPriority?: number;
  workspaceId?: string;
  folderId?: string | null;
  children: SidebarTreeNode[];
  depth: number;
}

export function Sidebar({ className }: Props) {
  const [hidden, setHidden] = useSidebarHidden();
  const sidebarRef = useRef<HTMLElement>(null);
  const activeWorkspace = useAtomValue(activeWorkspaceAtom);
  const [hasFocus, setHasFocus] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useAtom(sidebarSelectedIdsAtom);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [selectedTree, setSelectedTree] = useState<SidebarTreeNode | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoveredTree, setHoveredTree] = useState<SidebarTreeNode | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const { tree, treeParentMap, selectableRequests } = useAtomValue(sidebarTreeAtom);

  const toggleSelectedId = useCallback(
    (id: string | null, clear: boolean = false) => {
      setLastSelectedId(id);
      if (id == null) {
        setSelectedIds([]);
      } else if (clear) {
        setSelectedIds([id]);
      } else {
        setSelectedIds((ids) => {
          const withoutId = ids.filter((v) => v !== id);
          if (withoutId.length !== ids.length) {
            return withoutId;
          } else {
            console.log('APPENTING ID', id, ids);
            return [...ids, id];
          }
        });
      }
    },
    [setSelectedIds],
  );

  const focusActiveRequest = useCallback(
    (
      args: {
        forced?: {
          ids: string[];
          tree: SidebarTreeNode;
        };
        noFocusSidebar?: boolean;
      } = {},
    ) => {
      console.log("FOCUS ACTIVE REQUEST");
      const activeRequestId = jotaiStore.get(activeRequestIdAtom);
      const { forced, noFocusSidebar } = args;
      const tree = forced?.tree ?? treeParentMap[activeRequestId ?? 'n/a'] ?? null;
      const children = tree?.children ?? [];
      const ids = forced?.ids ?? children.filter((m) => m.id === activeRequestId).map((m) => m.id);

      setHasFocus(true);
      // setSelectedIds(ids);
      // setSelectedTree(tree);

      if (ids.length === 0) {
        return;
      }
      if (!noFocusSidebar) {
        sidebarRef.current?.focus();
      }
    },
    [treeParentMap],
  );

  const handleSelect = useCallback(
    async (id: string, e: MouseEvent | null) => {
      console.log("SELECT", e?.button);
      const tree = treeParentMap[id ?? 'n/a'] ?? null;
      const children = tree?.children ?? [];
      const node = children.find((m) => m.id === id) ?? null;
      if (node == null || tree == null || node.model === 'workspace') {
        return;
      }

      // NOTE: I'm not sure why, but TS thinks workspaceId is (string | undefined) here
      if (node.model !== 'folder' && node.workspaceId) {
        const workspaceId = node.workspaceId;
        await router.navigate({
          to: '/workspaces/$workspaceId',
          params: { workspaceId },
          search: (prev) => ({ ...prev, request_id: node.id }),
        });

        setHasFocus(true);
        if (e?.shiftKey) {
          const lastSelectedIndex =
            selectableRequests.findIndex((r) => r.id === lastSelectedId) ?? null;
          const currIndex = selectableRequests.findIndex((r) => r.id === id) ?? null;
          if (lastSelectedIndex === -1) {
            setSelectedIds([id]);
            setLastSelectedId(id);
          } else if (currIndex < lastSelectedIndex) {
            setSelectedIds(
              selectableRequests.slice(currIndex, lastSelectedIndex + 1).map((r) => r.id),
            );
            // NOTE: Don't update lastSelectedId when holding shift
          } else {
            setSelectedIds(
              selectableRequests.slice(lastSelectedIndex, currIndex + 1).map((r) => r.id),
            );
            // NOTE: Don't update lastSelectedId when holding shift
          }
        } else {
          toggleSelectedId(id, e == null || !e.metaKey);
        }
        setSelectedTree(tree);
      }
    },
    [treeParentMap, selectableRequests, lastSelectedId, setSelectedIds, toggleSelectedId],
  );

  const handleClearSelected = useCallback(() => {
    toggleSelectedId(null);
    setSelectedTree(null);
  }, [toggleSelectedId]);

  const handleFocus = useCallback(() => {
    if (hasFocus) return;
    focusActiveRequest({ noFocusSidebar: true });
  }, [focusActiveRequest, hasFocus]);

  const handleBlur = useCallback(() => setHasFocus(false), [setHasFocus]);

  useHotKey(
    'sidebar.delete_selected_item',
    async () => {
      for (const selectedId of selectedIds) {
        const request = getAnyModel(selectedId ?? 'n/a');
        if (request != null) {
          await deleteModelWithConfirm(request);
        }
      }
    },
    { enable: hasFocus },
  );

  useHotKey('sidebar.focus', async () => {
    // Hide the sidebar if it's already focused
    if (!hidden && hasFocus) {
      await setHidden(true);
      return;
    }

    // Show the sidebar if it's hidden
    if (hidden) {
      await setHidden(false);
    }

    // Select 0th index on focus if none selected
    focusActiveRequest(
      selectedTree != null && selectedIds.length > 0
        ? { forced: { ids: selectedIds, tree: selectedTree } }
        : undefined,
    );
  });

  useKeyPressEvent('Enter', async (e) => {
    if (!hasFocus) return;
    if (selectedIds.length === 0 || selectedIds.length > 1) return;

    const selectedId = selectedIds[0];
    const selected = selectableRequests.find((r) => r.id === selectedId);
    if (!selected || activeWorkspace == null) {
      return;
    }

    e.preventDefault();
    setWorkspaceSearchParams({ request_id: selected.id });
  });

  useKey(
    'ArrowUp',
    (e) => {
      if (!hasFocus) return;
      e.preventDefault();
      const i = selectableRequests.findLastIndex((r) => selectedIds.includes(r.id));
      const newI = i <= 0 ? selectableRequests.length - 1 : i - 1;
      const newSelectable = selectableRequests[newI];
      if (newSelectable == null) {
        return;
      }

      toggleSelectedId(newSelectable.id, !e.shiftKey);
      setSelectedTree(newSelectable.tree);
    },
    undefined,
    [hasFocus, selectableRequests, setSelectedTree],
  );

  useKey(
    'ArrowDown',
    (e) => {
      if (!hasFocus) return;
      e.preventDefault();
      const i = selectableRequests.findIndex((r) => selectedIds.includes(r.id));
      const newI = i >= selectableRequests.length - 1 ? 0 : i + 1;
      const newSelectable = selectableRequests[newI];
      if (newSelectable == null) {
        return;
      }

      if (e.shiftKey) {
        toggleSelectedId(newSelectable.id);
      } else {
        toggleSelectedId(newSelectable.id, true);
      }
      setSelectedTree(newSelectable.tree);
    },
    undefined,
    [hasFocus, selectableRequests, setSelectedTree],
  );

  const handleMoveToSidebarEnd = useCallback(() => {
    setHoveredTree(tree);
    // Put at the end of the top tree
    setHoveredIndex(tree?.children?.length ?? 0);
  }, [tree]);

  const handleMove = useCallback<SidebarItemProps['onMove']>(
    (id, side) => {
      let hoveredTree = treeParentMap[id] ?? null;
      const dragIndex = hoveredTree?.children.findIndex((n) => n.id === id) ?? -99;
      const hoveredItem = hoveredTree?.children[dragIndex] ?? null;
      let hoveredIndex = dragIndex + (side === 'above' ? 0 : 1);

      const collapsedMap = getSidebarCollapsedMap();
      const isHoveredItemCollapsed = hoveredItem != null ? collapsedMap[hoveredItem.id] : false;

      if (hoveredItem?.model === 'folder' && side === 'below' && !isHoveredItemCollapsed) {
        // Move into the folder if it's open and we're moving below it
        hoveredTree = hoveredTree?.children.find((n) => n.id === id) ?? null;
        hoveredIndex = 0;
      }

      setHoveredTree(hoveredTree);
      setHoveredIndex(hoveredIndex);
    },
    [treeParentMap],
  );

  const handleDragStart = useCallback<SidebarItemProps['onDragStart']>(
    async (id: string) => {
      await handleSelect(id, null);
      setDraggingId(id);
    },
    [handleSelect],
  );

  const handleEnd = useCallback<SidebarItemProps['onEnd']>(
    async (itemId) => {
      setHoveredTree(null);
      setDraggingId(null);
      handleClearSelected();

      if (hoveredTree == null || hoveredIndex == null) {
        return;
      }

      // Block dragging folder into itself
      if (hoveredTree.id === itemId) {
        return;
      }

      const parentTree = treeParentMap[itemId] ?? null;
      const index = parentTree?.children.findIndex((n) => n.id === itemId) ?? -1;
      const child = parentTree?.children[index ?? -1];
      if (child == null || parentTree == null) return;

      const movedToDifferentTree = hoveredTree.id !== parentTree.id;
      const movedUpInSameTree = !movedToDifferentTree && hoveredIndex < index;

      const newChildren = hoveredTree.children.filter((c) => c.id !== itemId);
      if (movedToDifferentTree || movedUpInSameTree) {
        // Moving up or into a new tree is simply inserting before the hovered item
        newChildren.splice(hoveredIndex, 0, child);
      } else {
        // Moving down has to account for the fact that the original item will be removed
        newChildren.splice(hoveredIndex - 1, 0, child);
      }

      const insertedIndex = newChildren.findIndex((c) => c.id === child.id);
      const prev = newChildren[insertedIndex - 1];
      const next = newChildren[insertedIndex + 1];
      const beforePriority = prev?.sortPriority ?? 0;
      const afterPriority = next?.sortPriority ?? 0;

      const folderId = hoveredTree.model === 'folder' ? hoveredTree.id : null;
      const shouldUpdateAll = afterPriority - beforePriority < 1;

      if (shouldUpdateAll) {
        await Promise.all(
          newChildren.map((child, i) => {
            const sortPriority = i * 1000;
            return patchModelById(child.model, child.id, { sortPriority, folderId });
          }),
        );
      } else {
        const sortPriority = afterPriority - (afterPriority - beforePriority) / 2;
        await patchModelById(child.model, child.id, { sortPriority, folderId });
      }
    },
    [handleClearSelected, hoveredTree, hoveredIndex, treeParentMap],
  );

  const [showMainContextMenu, setShowMainContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const handleMainContextMenu = useCallback((e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMainContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const mainContextMenuItems = useCreateDropdownItems({ folderId: null });

  const [, connectDrop] = useDrop<DragItem, void>(
    {
      accept: ItemTypes.REQUEST,
      hover: (_, monitor) => {
        if (sidebarRef.current == null) return;
        if (!monitor.isOver({ shallow: true })) return;
        handleMoveToSidebarEnd();
      },
    },
    [handleMoveToSidebarEnd],
  );

  connectDrop(sidebarRef);

  // Not ready to render yet
  if (tree == null) {
    return null;
  }

  return (
    <aside
      aria-hidden={hidden ?? undefined}
      ref={sidebarRef}
      onFocus={handleFocus}
      onBlur={handleBlur}
      tabIndex={hidden ? -1 : 0}
      onContextMenu={handleMainContextMenu}
      data-focused={hasFocus}
      className={classNames(
        className,
        // Style item selection color here, because it's very hard to do in an efficient
        // way in the item itself (selection ID makes it hard)
        hasFocus && '[&_[data-selected=true]]:bg-surface-active',
        'h-full grid grid-rows-[minmax(0,1fr)_auto]',
      )}
    >
      <div className="pb-3 overflow-x-visible overflow-y-scroll pt-2 pr-0.5">
        <ContextMenu
          triggerPosition={showMainContextMenu}
          items={mainContextMenuItems}
          onClose={() => setShowMainContextMenu(null)}
        />
        <SidebarItems
          treeParentMap={treeParentMap}
          selectedTree={selectedTree}
          tree={tree}
          draggingId={draggingId}
          onSelect={handleSelect}
          hoveredIndex={hoveredIndex}
          hoveredTree={hoveredTree}
          handleMove={handleMove}
          handleEnd={handleEnd}
          handleDragStart={handleDragStart}
        />
      </div>
      <GitDropdown />
    </aside>
  );
}
