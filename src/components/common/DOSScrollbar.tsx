import * as stylex from '@stylexjs/stylex';
import { useCallback, useEffect, useRef, useState } from 'react';
import { dosColors, dosFonts, dosShadows } from '../../styles/tokens.stylex';

const styles = stylex.create({
  scrollbar: {
    display: 'flex',
    flexDirection: 'column',
    width: '16px',
    backgroundColor: dosColors.gray,
    userSelect: 'none',
  },
  horizontal: {
    flexDirection: 'row',
    width: 'auto',
    height: '16px',
  },
  arrow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '16px',
    height: '16px',
    backgroundColor: dosColors.gray,
    color: dosColors.black,
    fontFamily: dosFonts.mono,
    fontSize: '10px',
    cursor: 'pointer',
    boxShadow: dosShadows.raised,
    ':hover': {
      backgroundColor: dosColors.lightGray,
    },
    ':active': {
      boxShadow: dosShadows.pressed,
    },
  },
  track: {
    flex: 1,
    position: 'relative',
    backgroundColor: dosColors.darkGray,
  },
  thumb: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: dosColors.gray,
    boxShadow: dosShadows.raised,
    cursor: 'pointer',
    minHeight: '20px',
    ':hover': {
      backgroundColor: dosColors.lightGray,
    },
  },
  thumbHorizontal: {
    top: 0,
    bottom: 0,
    left: 'auto',
    right: 'auto',
    minHeight: 'auto',
    minWidth: '20px',
  },
  thumbDragging: {
    backgroundColor: dosColors.lightGray,
  },
});

interface DOSScrollbarProps {
  orientation?: 'vertical' | 'horizontal';
  value: number; // 0-1 representing scroll position
  thumbSize: number; // 0-1 representing visible portion
  onChange: (value: number) => void;
  onScrollUp?: () => void;
  onScrollDown?: () => void;
}

export function DOSScrollbar({
  orientation = 'vertical',
  value,
  thumbSize,
  onChange,
  onScrollUp,
  onScrollDown,
}: DOSScrollbarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);

  const isVertical = orientation === 'vertical';

  // Calculate thumb position and size
  const clampedThumbSize = Math.max(0.1, Math.min(1, thumbSize));
  const thumbSizePercent = clampedThumbSize * 100;
  const maxPosition = 1 - clampedThumbSize;
  const thumbPosition = Math.min(value, maxPosition) * 100;

  const handleArrowUp = () => {
    if (onScrollUp) {
      onScrollUp();
    } else {
      onChange(Math.max(0, value - 0.1));
    }
  };

  const handleArrowDown = () => {
    if (onScrollDown) {
      onScrollDown();
    } else {
      onChange(Math.min(maxPosition, value + 0.1));
    }
  };

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current) return;

    const rect = trackRef.current.getBoundingClientRect();
    const clickPosition = isVertical
      ? (e.clientY - rect.top) / rect.height
      : (e.clientX - rect.left) / rect.width;

    // Move thumb to clicked position, centered
    const newValue = Math.max(
      0,
      Math.min(maxPosition, clickPosition - clampedThumbSize / 2)
    );
    onChange(newValue);
  };

  const handleThumbMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (!trackRef.current) return;

    const _rect = trackRef.current.getBoundingClientRect();
    const thumbElement = e.currentTarget;
    const thumbRect = thumbElement.getBoundingClientRect();

    const offset = isVertical
      ? e.clientY - thumbRect.top
      : e.clientX - thumbRect.left;

    setDragOffset(offset);
    setIsDragging(true);
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !trackRef.current) return;

      const rect = trackRef.current.getBoundingClientRect();
      const trackSize = isVertical ? rect.height : rect.width;
      const mousePosition = isVertical
        ? e.clientY - rect.top - dragOffset
        : e.clientX - rect.left - dragOffset;

      const newValue = Math.max(
        0,
        Math.min(maxPosition, mousePosition / trackSize)
      );
      onChange(newValue);
    },
    [isDragging, isVertical, dragOffset, maxPosition, onChange]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const thumbStyle = isVertical
    ? {
        top: `${thumbPosition}%`,
        height: `${thumbSizePercent}%`,
      }
    : {
        left: `${thumbPosition}%`,
        width: `${thumbSizePercent}%`,
      };

  return (
    <div
      {...stylex.props(
        styles.scrollbar,
        !isVertical && styles.horizontal
      )}
    >
      <div {...stylex.props(styles.arrow)} onClick={handleArrowUp}>
        {isVertical ? '\u25B2' : '\u25C0'}
      </div>
      <div
        ref={trackRef}
        {...stylex.props(styles.track)}
        onClick={handleTrackClick}
      >
        <div
          {...stylex.props(
            styles.thumb,
            !isVertical && styles.thumbHorizontal,
            isDragging && styles.thumbDragging
          )}
          style={thumbStyle}
          onMouseDown={handleThumbMouseDown}
        />
      </div>
      <div {...stylex.props(styles.arrow)} onClick={handleArrowDown}>
        {isVertical ? '\u25BC' : '\u25B6'}
      </div>
    </div>
  );
}
