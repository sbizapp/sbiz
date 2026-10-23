# sbiz.app — Default Background, Themes, and Liquid Glass Design Tokens

**Status:** Approved design direction; implementation pending.
**Scope:** Visual design system and appearance preferences. This document does not authorize frontend implementation or deployment.

## 1. Default background

Use the original first sbiz.app Liquid Glass UI concept generated during the design discussion: the soft pastel mountain-and-sky landscape behind the light and dark dashboards and mobile screens.

- This is the default background choice.
- Do not replace it with the later plain neutral-background concept.
- Retain the original image as a named, version-controlled project asset so users can restore it after choosing another background.
- The original generated image file still needs to be added to the repository's asset directory before implementation can reference it. This document records the approved visual choice and requirements, not proof that the image asset has been committed.

### Background rendering rules

- `background-size: cover`
- `background-position: center center` as the default; allow responsive focal-position adjustments only when needed to keep the image composition usable.
- `background-repeat: no-repeat`
- `background-attachment: fixed` must not be required; use normal scrolling behavior for reliable mobile performance.
- Place content on glass surfaces; do not put long body text or data tables directly on the image.
- Use an adaptive neutral overlay behind content only if contrast testing shows it is necessary. Overlay must not replace or permanently alter the stored original image.

## 2. Numeric Liquid Glass design tokens

These are the sbiz.app baseline values. Implementations must use shared design tokens rather than inventing module-specific values. Values below are proposed design-system constants for sbiz.app, not claims about Apple's proprietary implementation.

### 2.1 Shared geometry and effects

| Token | Fixed baseline |
|---|---|
| Glass surface opacity | 75% |
| Glass surface transparency | 25% |
| Standard border thickness | 1 px |
| Specular edge highlight thickness | 2 px |
| Inner top highlight thickness | 1 px |
| Outer highlight blur radius | 6 px |
| Outer highlight spread | 0 px |
| Desktop backdrop blur | 16 px |
| Mobile backdrop blur | 12 px |
| Backdrop saturation | 140% |
| Standard panel corner radius | 16 px |
| Compact control corner radius | 10 px |
| Large dashboard/card corner radius | 20 px |
| Standard panel shadow | 0 8px 24px |
| Shadow spread | 0 px |
| Default transition duration | 180 ms |
| Default transition easing | cubic-bezier(0.2, 0.7, 0.2, 1) |

Do not add neon glow, large colored halos, strong bloom, or heavy multi-layer shadows. The edge highlight must read as a restrained reflection along the panel edge, not a luminous outline around the entire component.

### 2.2 Light theme color tokens

| Token | Fixed value | Use |
|---|---|---|
| Page base fallback | `#E9EDF3` | Fallback below the background image |
| Main text | `#182230` | Primary text |
| Secondary text | `#526174` | Supporting text |
| Glass surface | `rgba(255,255,255,0.75)` | Standard glass panels |
| Glass surface elevated | `rgba(255,255,255,0.84)` | Dialogs and important overlays |
| Glass border | `rgba(255,255,255,0.78)` | 1 px panel border |
| Inner top specular highlight | `rgba(255,255,255,0.95)` | 1 px inner top edge |
| Edge highlight | `rgba(255,255,255,0.72)` | 2 px restrained reflective edge |
| Edge highlight blur color | `rgba(180,205,235,0.18)` | 6 px soft edge reflection |
| Panel shadow | `rgba(31,45,66,0.12)` | 0 8px 24px shadow |
| Primary accent | `#1677F2` | Primary action and active states |
| Divider | `rgba(24,34,48,0.10)` | Separators |

### 2.3 Dark theme color tokens

| Token | Fixed value | Use |
|---|---|---|
| Page base fallback | `#0B1018` | Fallback below the background image |
| Main text | `#F3F6FA` | Primary text |
| Secondary text | `#B4C0D0` | Supporting text |
| Glass surface | `rgba(15,23,35,0.75)` | Standard glass panels |
| Glass surface elevated | `rgba(22,32,47,0.88)` | Dialogs and important overlays |
| Glass border | `rgba(210,225,245,0.20)` | 1 px panel border |
| Inner top specular highlight | `rgba(255,255,255,0.24)` | 1 px inner top edge |
| Edge highlight | `rgba(190,215,245,0.30)` | 2 px restrained reflective edge |
| Edge highlight blur color | `rgba(90,145,215,0.16)` | 6 px soft edge reflection |
| Panel shadow | `rgba(0,0,0,0.32)` | 0 8px 24px shadow |
| Primary accent | `#3B91FF` | Primary action and active states |
| Divider | `rgba(230,238,250,0.12)` | Separators |

### 2.4 Border and specular construction

- Every standard glass panel has a 1 px border using the theme's `Glass border` token.
- Add a 1 px inner top highlight using the theme's `Inner top specular highlight` token.
- Use a maximum 2 px reflective edge treatment using the theme's `Edge highlight` token.
- The reflective edge may use a linear gradient so its strongest reflection is on the top and upper side edges; the bottom edge must remain restrained.
- The 6 px highlight blur uses the theme's `Edge highlight blur color` token. Do not increase blur or opacity per component.
- Do not add a separate outer glow unless a later approved design revision explicitly changes this standard.

### 2.5 Blur and readability

- Desktop glass surfaces: `backdrop-filter: blur(16px) saturate(140%)`.
- Mobile glass surfaces: `backdrop-filter: blur(12px) saturate(140%)`.
- If backdrop filtering is unsupported or too expensive, use the theme's opaque/elevated fallback surface.
- Tables, form controls, dialogs, navigation, and text-heavy content must remain readable. Increase surface opacity only through the defined elevated token or a future centrally approved token, not with local arbitrary values.
- The 75% surface opacity is the standard target; do not interpret it as a requirement to make all controls equally transparent.

## 3. User background customization

Provide a setting under Appearance / UI Settings to choose another background and a clear **Restore default background** action.

- The original default asset must remain available independently of the user's selection.
- Persist each user's chosen background preference so it remains selected on later visits.
- Changing the background must not change layout, functionality, data, permissions, L1/L2 settings, or business identity.
- If a custom background is removed or unavailable, fall back to the original default.
- Restoring the default means selecting the original first landscape image, not the plain neutral-background concept.

## 4. Themes

Provide two themes:

- **Light:** use the light color tokens above.
- **Dark:** use the dark color tokens above.

Theme selection and background selection are independent settings. Both themes must support the original default landscape background. Theme switching changes the component color tokens, not the user's selected background.

## 5. Language choices and market flags

The UI offers five languages: English, Vietnamese, Indonesian, Spanish, and Portuguese. Language identity and market targeting must be represented separately.

Use these display labels and flag choices in the language selector:

| UI language | Language code | Flag shown | Market intent |
|---|---|---|---|
| English | `en` | 🇺🇸 | Prioritize the United States market for English |
| Tiếng Việt | `vi` | 🇻🇳 | Vietnamese language option |
| Bahasa Indonesia | `id` | 🇮🇩 | Indonesian language option |
| Español | `es` | 🇲🇽 | Prioritize the Mexican market for Spanish |
| Português | `pt` | 🇧🇷 | Prioritize the Brazilian market for Portuguese |

For English, display the United States flag 🇺🇸 to emphasize the intended focus on the US market. For Spanish, display the Mexican flag 🇲🇽 to emphasize the intended focus on Mexico and the wider Latin American market rather than Spain. For Portuguese, display the Brazilian flag 🇧🇷 to emphasize the intended focus on Brazil rather than Portugal.

These flags are market-positioning cues in the UI, not a claim that English is exclusive to the United States, Spanish is exclusive to Mexico, or Portuguese is exclusive to Brazil. Keep the language codes `en`, `es`, and `pt`; do not change them to country codes. Where technically feasible, use a flag icon asset or a reliable emoji presentation that renders consistently across supported devices.

## 6. Responsive and performance requirements

- Preserve the AppSheet-inspired principle of well-proportioned tables and controls on desktop, with carefully adapted layouts on mobile.
- Do not shrink desktop tables proportionally onto mobile. Use responsive column priorities, horizontal scrolling only where appropriate, or mobile card/list layouts according to the table's purpose.
- Keep the background decorative; data and actions must remain visually dominant.
- Use optimized image formats and responsive image dimensions.
- Avoid heavy animation, continuous blur animation, and expensive visual effects.
- Keep the image itself unmodified as the restorable default asset; any overlays are rendering layers, not edits to the original file.

## 7. Acceptance criteria

1. The original first concept is the default background direction.
2. The original image asset is present in the repository before implementation is considered complete.
3. Users can select another background and restore the original default.
4. Light and dark themes use the exact tokens specified in this document.
5. Glass opacity, border thickness, highlight thickness, highlight blur, backdrop blur, radii, shadows, and transition timing use the shared numeric values above.
6. Modules do not invent their own Liquid Glass values.
7. The language selector uses `en` with the United States flag, `es` with the Mexican flag, and `pt` with the Brazilian flag, while retaining the correct language codes.
8. Tables, controls, and text remain readable on desktop and mobile.
9. This document alone is not evidence that the image asset has been committed or the feature implemented.
