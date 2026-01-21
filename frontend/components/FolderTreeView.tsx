/**
 * FolderTreeView Component
 * Displays nested folder hierarchy with media counts and hide toggles
 */
'use client';

import { useState } from 'react';
import { ChevronRight, ChevronDown, Eye, EyeOff, Folder } from 'lucide-react';

interface FolderNode {
  path: string;
  name: string;
  mediaCount: number;
  hidden: boolean;
  children: FolderNode[];
}

interface FolderTreeViewProps {
  tree: FolderNode;
  onToggleHide: (folderPath: string) => void;
  isLoading?: boolean;
}

export function FolderTreeView({ tree, onToggleHide, isLoading }: FolderTreeViewProps) {
  return (
    <div className="space-y-2">
      <FolderTreeNode node={tree} onToggleHide={onToggleHide} isLoading={isLoading} level={0} />
    </div>
  );
}

interface FolderTreeNodeProps {
  node: FolderNode;
  onToggleHide: (folderPath: string) => void;
  isLoading?: boolean;
  level: number;
}

function FolderTreeNode({ node, onToggleHide, isLoading, level }: FolderTreeNodeProps) {
  const [isExpanded, setIsExpanded] = useState(level < 2); // Auto-expand first 2 levels
  const hasChildren = node.children.length > 0;

  return (
    <div className="select-none">
      <div
        className={`flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors ${node.hidden ? 'opacity-50' : ''
          }`}
        style={{ paddingLeft: `${level * 1.5 + 0.75}rem` }}
      >
        {/* Expand/Collapse Button */}
        {hasChildren ? (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-0.5 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors"
            aria-label={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            )}
          </button>
        ) : (
          <div className="w-5" /> // Spacer for alignment
        )}

        {/* Folder Icon */}
        <Folder
          className={`w-4 h-4 ${node.hidden
            ? 'text-gray-400 dark:text-gray-600'
            : 'text-blue-500 dark:text-blue-400'
            }`}
        />

        {/* Folder Name and Media Count */}
        <div className="flex-1 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span
              className={`text-sm font-medium ${node.hidden
                ? 'text-gray-500 dark:text-gray-500 line-through'
                : 'text-gray-900 dark:text-gray-100'
                }`}
            >
              {node.name}
            </span>
            <span className="text-xs text-gray-500 dark:text-gray-400">
              ({node.mediaCount} {node.mediaCount === 1 ? 'item' : 'items'})
            </span>
          </div>

          {/* Hide Toggle Button - Only show for non-root folders */}
          {level > 0 && (
            <button
              onClick={() => onToggleHide(node.path)}
              disabled={isLoading}
              className={`p-1.5 rounded-lg transition-colors ${node.hidden
                ? 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-900/50'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              aria-label={node.hidden ? 'Show folder' : 'Hide folder'}
              title={node.hidden ? 'Show folder' : 'Hide folder'}
            >
              {node.hidden ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="mt-1">
          {node.children.map((child) => (
            <FolderTreeNode
              key={child.path}
              node={child}
              onToggleHide={onToggleHide}
              isLoading={isLoading}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
