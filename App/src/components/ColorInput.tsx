import React, { useMemo, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import tinycolor from 'tinycolor2';

interface ColorInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  variable: string;
}

export const ColorInput: React.FC<ColorInputProps> = ({ label, value, onChange, variable }) => {
  const defaultValue = useMemo(() => getComputedStyle(document.documentElement).getPropertyValue(variable).trim() || '#000000', [variable]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  const currentColor = useMemo(() => {
    const color = value || defaultValue;
    const parsed = tinycolor(color);
    return parsed.isValid() ? parsed.toHexString() : '#000000';
  }, [value, defaultValue]);

  const updateColor = (nextColor: string) => {
    const parsed = tinycolor(nextColor);
    if (parsed.isValid()) {
      onChange(parsed.toHexString());
    } else {
      onChange(nextColor);
    }
  };

  return (
    <div style={{ marginBottom: '10px' }}>
      <label style={{ display: 'flex', alignItems: 'center', fontSize: '13px', marginBottom: '4px' }}>
        <span style={{ flex: 1 }}>{label}</span>
        <button
          type="button"
          aria-label="Open color picker"
          onClick={() => setIsPickerOpen((open) => !open)}
          style={{
            width: '22px',
            height: '22px',
            borderRadius: '4px',
            border: `1px solid var(--border-primary)`,
            background: currentColor,
            cursor: 'pointer',
            marginRight: '6px',
          }}
        />
        <input
          type="text"
          value={currentColor}
          onChange={(e) => updateColor(e.target.value)}
          style={{
            width: '90px',
            marginRight: '8px',
            padding: '4px 8px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: '4px',
            color: 'var(--text-primary)',
            fontSize: '12px',
          }}
        />
        <button
          type="button"
          onClick={() => updateColor(tinycolor(currentColor).lighten(10).toHexString())}
          style={{ fontSize: '12px', padding: '4px 8px', marginRight: '4px', borderRadius: '4px', border: '1px solid var(--border-primary)', cursor: 'pointer' }}
        >
          +
        </button>
        <button
          type="button"
          onClick={() => updateColor(tinycolor(currentColor).darken(10).toHexString())}
          style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-primary)', cursor: 'pointer' }}
        >
          -
        </button>
      </label>

      {isPickerOpen && (
        <div style={{ position: 'relative', marginTop: '6px' }}>
          <div style={{ position: 'absolute', zIndex: 200, boxShadow: '0 4px 12px rgba(0,0,0,0.25)', borderRadius: '8px' }}>
            <HexColorPicker
              color={currentColor}
              onChange={(newColor) => updateColor(newColor)}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default ColorInput; 