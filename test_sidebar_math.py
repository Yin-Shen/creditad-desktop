"""
Test CSS math for sidebar at 390px screen width (mobile/ultra-narrow)
"""

# Sidebar dimensions at different breakpoints
sidebar_width_desktop = 220
sidebar_width_mobile = 150  # at max-width: 768px

# Nav item layout (flexbox)
nav_item_display = "flex"  # flexbox (no wrap rule means: wrap: nowrap)
nav_item_padding_lr = 12   # left/right in tablet rule (10px 12px)
nav_item_padding_tb = 10   # top/bottom
nav_item_margin_lr = 10    # left/right

# Icon
icon_width = 18
icon_margin_right = 10

# Nav items
nav_items = [
    "Home",
    "Import Files",
    "Visualization",
    "Local Reviews",
    "Data Manager",
    "Settings"
]

# Calculate available space for text
# width: calc(100% - 20px) => 100% of parent minus 20px
# parent is sidebar at mobile => 150px
# nav-item width = 150 - 20 = 130px
# but nav-item has padding: 10px 12px => content area = 130 - 2*12 = 106px
# icon takes 18px, gap 10px => space for text = 106 - 18 - 10 = 78px

nav_item_width = sidebar_width_mobile - 20  # = 130px
nav_item_content_width = nav_item_width - 2 * nav_item_padding_lr  # = 130 - 24 = 106px
text_space = nav_item_content_width - icon_width - icon_margin_right  # = 106 - 28 = 78px

print(f"At 390px screen (mobile, <=768px breakpoint):")
print(f"  Sidebar width: {sidebar_width_mobile}px")
print(f"  Nav-item width: {nav_item_width}px")
print(f"  Nav-item content width (after padding): {nav_item_content_width}px")
print(f"  Space for text (after icon + gap): {text_space}px")
print(f"  Font size: 13px (tablet rule applies)")
print()
print(f"Character fit estimate at 13px font (approx 4-5px per char):")
for item in nav_items:
    chars = len(item)
    est_width = chars * 4.5  # rough estimate
    fits = "✓ fits" if est_width <= text_space else f"✗ overflow ({est_width:.0f}px needed)"
    print(f"  '{item}' ({chars} chars, ~{est_width:.0f}px) {fits}")

print()
print("CSS rules in effect at 390px (<=768px):")
print("  1. .sidebar { width: 150px; }")
print("  2. .nav-item { padding: 10px 12px; font-size: 13px; }")
print("  3. .nav-item { display: flex; }")
print("     (default flex-wrap: nowrap - items will NOT wrap)")
print()
print("CRITICAL: No white-space, overflow-x, or text-overflow rules on .nav-item")
print("  => Text will overflow container horizontally OR line break within flex container")
print("  => Parent flexbox has flex-wrap: nowrap, but text itself has no constraint")
print("  => Result: text will overflow outside the flex item bounds (not visible or cut off)")
