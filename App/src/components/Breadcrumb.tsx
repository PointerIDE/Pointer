import React, { useState } from 'react';
import '../styles/Breadcrumb.css';

interface BreadcrumbItem {
  id: string;
  name: string;
  path: string;
  isDirectory?: boolean;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
  onNavigate: (itemId: string, path: string) => void;
  onContextMenu?: (itemId: string, e: React.MouseEvent) => void;
  maxLength?: number;
}

/**
 * Breadcrumb Navigation Component
 * Shows the file/folder navigation hierarchy with click-to-navigate
 * and context menu support for quick actions
 */
const Breadcrumb: React.FC<BreadcrumbProps> = ({
  items,
  onNavigate,
  onContextMenu,
  maxLength = 50
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [showEllipsisMenu, setShowEllipsisMenu] = useState(false);

  // Truncate long paths with ellipsis
  const displayItems = items.length > 5
    ? [items[0], { id: 'ellipsis', name: '...', path: '' }, ...items.slice(-3)]
    : items;

  const handleItemClick = (item: BreadcrumbItem) => {
    if (item.id !== 'ellipsis') {
      onNavigate(item.id, item.path);
    }
  };

  const handleEllipsisClick = () => {
    setShowEllipsisMenu(!showEllipsisMenu);
  };

  return (
    <nav className="breadcrumb" role="navigation" aria-label="File breadcrumb">
      <div className="breadcrumb-items">
        {displayItems.map((item, idx) => (
          <React.Fragment key={`${item.id}-${idx}`}>
            {idx > 0 && <span className="breadcrumb-separator">/</span>}
            
            {item.id === 'ellipsis' ? (
              <div className="breadcrumb-ellipsis">
                <button
                  className="breadcrumb-ellipsis-btn"
                  onClick={handleEllipsisClick}
                  title="Show more paths"
                >
                  ⋯
                </button>
                {showEllipsisMenu && (
                  <div className="breadcrumb-ellipsis-menu">
                    {items.slice(1, -3).map((subItem, subIdx) => (
                      <div
                        key={`${subItem.id}-${subIdx}`}
                        className="breadcrumb-ellipsis-item"
                        onClick={() => {
                          handleItemClick(subItem);
                          setShowEllipsisMenu(false);
                        }}
                      >
                        {subItem.isDirectory && <span className="breadcrumb-icon">📁</span>}
                        {!subItem.isDirectory && <span className="breadcrumb-icon">📄</span>}
                        <span className="breadcrumb-ellipsis-text">{subItem.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <button
                className={`breadcrumb-item ${hoveredIndex === idx ? 'hovered' : ''}`}
                onClick={() => handleItemClick(item)}
                onMouseEnter={() => setHoveredIndex(idx)}
                onMouseLeave={() => setHoveredIndex(null)}
                onContextMenu={(e) => onContextMenu?.(item.id, e)}
                title={item.path}
                disabled={item.id === 'ellipsis'}
              >
                {item.isDirectory && <span className="breadcrumb-icon">📁</span>}
                {!item.isDirectory && <span className="breadcrumb-icon">📄</span>}
                <span className="breadcrumb-label">{item.name}</span>
              </button>
            )}
          </React.Fragment>
        ))}
      </div>
    </nav>
  );
};

export default Breadcrumb;
