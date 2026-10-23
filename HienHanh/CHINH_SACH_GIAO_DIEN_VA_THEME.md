# sbiz.app — Minimal White UI Design Standard

**Status:** Owner-approved design direction, 2026-10-23.
**Authority:** This is the active minimal UI standard. Previous Glass design guidance is retired and must not be used.

## 1. Core rule

Every visible UI object uses a plain white background `#ffffff`, a thin light-gray border, and only a subtle, light shadow.

- Surface background: `#ffffff` for every component, including page-level surfaces, panels, cards, forms, inputs, tables, navigation, dialogs, dropdowns, and buttons.
- Border: 1 px solid light gray, baseline `#e5e7eb`.
- Shadow: optional and restrained, baseline `0 1px 2px rgba(0,0,0,0.05)`; do not stack shadows.
- Font family: `Roboto, Arial, sans-serif`, with a normal sans-serif fallback.
- Use regular (400) body text and medium (500) headings and controls; avoid heavy typography.
- Main text: `#111827`.
- Secondary text: `#6b7280`.
- Dividers: `#e5e7eb`.
- Corner radius: restrained and consistent; default 6 px for controls and 8 px for panels.
- Page background: `#ffffff`.

## 2. Explicitly prohibited

Do not use:
- Background images, decorative page backgrounds, texture, or patterned surfaces.
- Transparency, frosted glass, `backdrop-filter`, blur, or saturation effects.
- Gradients, specular highlights, glow, neon, decorative particles, or ornamental effects.
- Dark-mode alternate surfaces or color-scheme-driven component colors.
- Heavy shadows, multi-layer shadows, or large floating-card effects.
- Module-specific styling that conflicts with this standard.

Do not delete or modify the original image assets in storage as part of this UI change; simply stop rendering them as interface backgrounds.

## 3. Component rules

- All objects have a white background and a thin light-gray border. This includes buttons and form controls; distinguish action priority with text weight and restrained border treatment, not filled color backgrounds.
- Primary actions may use stronger font weight, but their surface remains white.
- Inputs and selects must remain clearly bounded and have visible keyboard focus indicators.
- Tables use white cells, light-gray separators, and a white header. Hover states may change text or border subtly but must not introduce colored or translucent fills.
- Status labels remain white with a light-gray border; status meaning may be expressed in text.
- Avoid unnecessary containers. Use spacing and alignment to establish hierarchy.
- Preserve existing product behavior, routes, APIs, authorization, data, and business rules.
- Preserve responsive layouts. On mobile, adapt tables appropriately rather than shrinking the entire desktop interface.

## 4. Implementation guidance

Use shared CSS tokens wherever practical:
```css
:root {
  --ui-surface: #ffffff;
  --ui-border: #e5e7eb;
  --ui-text: #111827;
  --ui-muted: #6b7280;
  --ui-divider: #e5e7eb;
  --ui-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  --ui-radius-control: 6px;
  --ui-radius-panel: 8px;
}
```

A change is not complete merely because this policy or a stylesheet has been committed. Verify all UI modules and shared components for prohibited legacy effects, run the relevant checks, and inspect the rendered result on desktop and mobile. Do not deploy production without Owner authorization.
