# sbiz.app — Default Background and Theme Policy

**Status:** Approved design direction; implementation pending.
**Scope:** Visual design preference only. This document does not authorize frontend implementation or deployment.

## Default background

Use the original first sbiz.app Liquid Glass UI concept generated during the design discussion (the concept with a soft pastel mountain-and-sky landscape behind the light and dark dashboards and mobile screens) as the default visual direction and default background asset.

Do not replace this default with the later plain neutral-background concept.

The original default background must be retained as a named, version-controlled project asset so users can restore it after choosing another background. The actual generated image file still needs to be added to the repository's asset directory before implementation can reference it; this document records the approved choice and retention requirement.

## User customization

- Provide a setting under Appearance / UI Settings to choose another background.
- Provide a clear "Restore default background" action.
- Changing the background must not change page layout, functionality, data, or permissions.
- Keep the default background available even after a user selects a custom background.
- Persist each user's background preference so it remains selected on later visits.
- If a custom background is removed or unavailable, fall back safely to the default background.

## Themes

Provide two themes:
- Light: soft milk-white surfaces and light frosted-glass panels.
- Dark: near-black / charcoal surfaces and dark frosted-glass panels.

The default landscape background should be compatible with both themes. Theme selection and background selection are related appearance settings but should remain independently selectable.

## Liquid Glass visual language

- Use restrained translucent surfaces (approximately 75% opacity as the initial visual target, subject to readability testing).
- Use subtle mirror-like edge highlights to define glass-panel boundaries.
- Keep depth and shadow restrained.
- Avoid neon, excessive glow, and heavy shadows.
- Preserve text contrast and accessibility over the image.

## Responsive and performance requirements

- Preserve the AppSheet-inspired principle of well-proportioned tables and controls on desktop, with carefully adapted layouts on mobile.
- Tables and business content must remain readable over any background.
- Use optimized image formats and dimensions appropriate for web delivery.
- Avoid heavy animation or expensive visual effects.
- The background must remain decorative and must not compete with business content.

## Acceptance criteria

1. The original first concept is the default visual direction.
2. The default background asset is retained in the repository and cannot be lost when a user chooses a different background.
3. Users can choose another background and later restore the default.
4. Light and dark themes both work with the default background.
5. Content, tables, and controls remain readable on desktop and mobile.
6. This document alone is not evidence that the image asset has been committed or the feature implemented.
