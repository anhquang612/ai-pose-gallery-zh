# -*- coding: utf-8 -*-
"""ComfyUI custom nodes: AI character reference library (pose + costume + portrait + 3-in-1 recipe).

Locally modified: English node names, sockets, options and prompts (see data/i18n-en.json).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .routes import find_item, open_reference_image, select_costume_view, tr

if TYPE_CHECKING:
    from PIL import Image

CATEGORY = "AI Character Reference"

RESIZE_ORIGINAL = "original size"
RESIZE_CROP = "fit (center crop)"
RESIZE_PAD = "fit (pad)"
RESIZE_MODES = [RESIZE_ORIGINAL, RESIZE_CROP, RESIZE_PAD]

COSTUME_VIEWS = ["front", "diag", "side", "back"]

STYLE_PRESETS = {
    "anime (HD)": "anime illustration, cel shading and soft lighting, clean lineart, masterpiece, best quality",
    "photorealistic portrait": "photorealistic portrait photography, 85mm lens, realistic skin texture, cinematic lighting, 8k",
    "semi-realistic (K-style)": "semi-realistic anime character art, smooth rendering, luminous highlights, refined color palette",
    "character design sheet": "character design reference sheet, clean light background, crisp silhouette, detailed fabric folds",
}
DEFAULT_STYLE = "anime (HD)"


def _pil_to_comfy_tensor(img: Image.Image):
    import numpy as np
    import torch

    rgb = img.convert("RGB")
    arr = np.asarray(rgb, dtype=np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0)


def _load_pil_image(
    rel_path: str,
    resize_mode: str = RESIZE_ORIGINAL,
    width: int = 1024,
    height: int = 1280,
    flip_horizontal: bool = False,
) -> Image.Image:
    from PIL import Image, ImageOps

    img = open_reference_image(rel_path)
    img = ImageOps.exif_transpose(img).convert("RGB")

    if flip_horizontal:
        img = ImageOps.mirror(img)

    target_w = max(64, int(width))
    target_h = max(64, int(height))

    if resize_mode == RESIZE_CROP:
        img = ImageOps.fit(img, (target_w, target_h), method=Image.Resampling.LANCZOS)
    elif resize_mode == RESIZE_PAD:
        img = ImageOps.pad(
            img,
            (target_w, target_h),
            method=Image.Resampling.LANCZOS,
            color=(245, 245, 247),
        )

    return img


def _pose_prompt(item: dict) -> str:
    title = tr(item.get("姿势名称") or item.get("标题") or "") or "standard pose"
    angle = tr(item.get("角度", "")) or "front"
    cat = tr(item.get("分类", ""))
    return f"{angle.lower()} view, pose: {title}" + (f" ({cat.lower()})" if cat else "")


def _costume_prompts(item: dict) -> tuple[str, str]:
    """Returns (short description, detailed English keywords)."""
    keywords = item.get("关键词", "") or ""
    cat = tr(item.get("分类", ""))
    tags = [tr(t) for t in item.get("标签", [])[:8]]
    cat_l = cat.lower()
    desc = (cat_l if "outfit" in cat_l else f"{cat_l} outfit") if cat else "outfit"
    if tags:
        desc += ": " + ", ".join(tags)
    return desc, keywords or desc


def _portrait_prompt(item: dict) -> str:
    hair_len = tr(item.get("发长", ""))
    hair_style = tr(item.get("发型名称") or item.get("发型") or "")
    parts = [p.lower() for p in (hair_len, hair_style) if p]
    return "face and hairstyle reference: " + ", ".join(parts) if parts else "face reference"


def _pose_image_rel_path(item: dict, use_depth: bool = False) -> str:
    raw = str(item.get("原图", "")).lstrip("/")
    if use_depth and raw.startswith("img/") and not raw.startswith("img/depth/"):
        stem = raw[len("img/") :].rsplit(".", 1)[0]
        return f"img/depth/{stem}.webp"
    return raw


def _common_inputs(default_id: str) -> dict:
    return {
        "image_id": ("STRING", {"default": default_id, "multiline": False}),
        "resize_mode": (RESIZE_MODES, {"default": RESIZE_ORIGINAL}),
        "width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8}),
        "height": ("INT", {"default": 1280, "min": 64, "max": 4096, "step": 8}),
        "flip_horizontal": ("BOOLEAN", {"default": False}),
    }


class PoseGalleryNode:
    """Pick a pose reference (mannequin or depth map) from 1,439 poses; outputs IMAGE + pose prompt."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": _common_inputs("full_single_P001_front"),
            "optional": {"use_depth": ("BOOLEAN", {"default": False})},
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("pose_image", "image_id", "pose_prompt")
    FUNCTION = "load_pose"
    CATEGORY = CATEGORY

    def load_pose(
        self,
        image_id: str = "full_single_P001_front",
        resize_mode: str = RESIZE_ORIGINAL,
        width: int = 1024,
        height: int = 1280,
        flip_horizontal: bool = False,
        use_depth: bool = False,
    ):
        item = find_item("pose", image_id)
        pil_img = _load_pil_image(
            _pose_image_rel_path(item, use_depth=use_depth),
            resize_mode=resize_mode,
            width=width,
            height=height,
            flip_horizontal=flip_horizontal,
        )
        return (_pil_to_comfy_tensor(pil_img), item["id"], _pose_prompt(item))


class CostumeGalleryNode:
    """Pick an outfit (and view angle) from the costume library; outputs IMAGE + outfit prompts."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": _common_inputs("SPR-0001"),
            "optional": {"costume_view": (COSTUME_VIEWS, {"default": "front"})},
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("costume_image", "image_id", "costume_description", "costume_prompt")
    FUNCTION = "load_costume"
    CATEGORY = CATEGORY

    def load_costume(
        self,
        image_id: str = "SPR-0001",
        resize_mode: str = RESIZE_ORIGINAL,
        width: int = 1024,
        height: int = 1280,
        flip_horizontal: bool = False,
        costume_view: str = "front",
    ):
        item = select_costume_view(find_item("costume", image_id), costume_view)
        pil_img = _load_pil_image(
            item["原图"],
            resize_mode=resize_mode,
            width=width,
            height=height,
            flip_horizontal=flip_horizontal,
        )
        desc, prompt = _costume_prompts(item)
        return (_pil_to_comfy_tensor(pil_img), item["id"], desc, prompt)


class PortraitGalleryNode:
    """Pick a face/hairstyle reference from 1,499 portraits; outputs IMAGE + hairstyle prompt."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": _common_inputs("f71f980dde3")}

    RETURN_TYPES = ("IMAGE", "STRING", "STRING")
    RETURN_NAMES = ("portrait_image", "image_id", "hairstyle_prompt")
    FUNCTION = "load_portrait"
    CATEGORY = CATEGORY

    def load_portrait(
        self,
        image_id: str = "f71f980dde3",
        resize_mode: str = RESIZE_ORIGINAL,
        width: int = 1024,
        height: int = 1280,
        flip_horizontal: bool = False,
    ):
        item = find_item("portrait", image_id)
        pil_img = _load_pil_image(
            item["原图"],
            resize_mode=resize_mode,
            width=width,
            height=height,
            flip_horizontal=flip_horizontal,
        )
        return (_pil_to_comfy_tensor(pil_img), item["id"], _portrait_prompt(item))


class CharacterRecipeNode:
    """3-in-1 recipe: outputs portrait, costume, pose images, a side-by-side reference sheet, and assembled prompts."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "portrait_id": ("STRING", {"default": "f71f980dde3", "multiline": False}),
                "costume_id": ("STRING", {"default": "SPR-0001", "multiline": False}),
                "pose_id": ("STRING", {"default": "full_single_P001_front", "multiline": False}),
                "style_preset": (list(STYLE_PRESETS.keys()), {"default": DEFAULT_STYLE}),
                "extra_prompt": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "placeholder": "Optional extra prompt (e.g. silver eyes, backlit classroom window, hair in the breeze)",
                    },
                ),
                "resize_mode": (RESIZE_MODES, {"default": RESIZE_CROP}),
                "width": ("INT", {"default": 1024, "min": 64, "max": 4096, "step": 8}),
                "height": ("INT", {"default": 1280, "min": 64, "max": 4096, "step": 8}),
                "flip_pose_horizontal": ("BOOLEAN", {"default": False}),
            },
            "optional": {
                "use_depth": ("BOOLEAN", {"default": False}),
                "costume_view": (COSTUME_VIEWS, {"default": "front"}),
            },
        }

    RETURN_TYPES = ("IMAGE", "IMAGE", "IMAGE", "IMAGE", "STRING", "STRING")
    RETURN_NAMES = (
        "portrait_image",
        "costume_image",
        "pose_image",
        "reference_sheet",
        "instruction_prompt",
        "tag_prompt",
    )
    FUNCTION = "build_recipe"
    CATEGORY = CATEGORY

    def build_recipe(
        self,
        portrait_id: str = "f71f980dde3",
        costume_id: str = "SPR-0001",
        pose_id: str = "full_single_P001_front",
        style_preset: str = DEFAULT_STYLE,
        extra_prompt: str = "",
        resize_mode: str = RESIZE_CROP,
        width: int = 1024,
        height: int = 1280,
        flip_pose_horizontal: bool = False,
        use_depth: bool = False,
        costume_view: str = "front",
    ):
        portrait_item = find_item("portrait", portrait_id)
        costume_item = select_costume_view(find_item("costume", costume_id), costume_view)
        pose_item = find_item("pose", pose_id)

        portrait_pil = _load_pil_image(portrait_item["原图"], resize_mode=resize_mode, width=width, height=height)
        costume_pil = _load_pil_image(costume_item["原图"], resize_mode=resize_mode, width=width, height=height)
        pose_pil = _load_pil_image(
            _pose_image_rel_path(pose_item, use_depth=use_depth),
            resize_mode=resize_mode,
            width=width,
            height=height,
            flip_horizontal=flip_pose_horizontal,
        )

        # Side-by-side reference sheet: portrait | costume | pose
        from PIL import Image, ImageOps

        panel_h = max(256, int(height))
        panel_w = max(256, int(width))
        p1 = ImageOps.fit(portrait_pil, (panel_w, panel_h), method=Image.Resampling.LANCZOS)
        p2 = ImageOps.fit(costume_pil, (panel_w, panel_h), method=Image.Resampling.LANCZOS)
        p3 = ImageOps.fit(pose_pil, (panel_w, panel_h), method=Image.Resampling.LANCZOS)
        gap = 12
        composite = Image.new("RGB", (panel_w * 3 + gap * 2, panel_h), (24, 24, 29))
        composite.paste(p1, (0, 0))
        composite.paste(p2, (panel_w + gap, 0))
        composite.paste(p3, ((panel_w + gap) * 2, 0))

        portrait_p = _portrait_prompt(portrait_item)
        costume_desc, costume_kw = _costume_prompts(costume_item)
        pose_p = _pose_prompt(pose_item)
        style = STYLE_PRESETS.get(style_preset, STYLE_PRESETS[DEFAULT_STYLE])
        extra_clean = (extra_prompt or "").strip()

        instruction = [
            f"Combine the reference images into one complete character illustration. Style: {style}.",
            f"Face and hair: take from the portrait reference ({portrait_p}).",
            f"Outfit: take from the costume reference ({costume_kw}).",
            f"Body pose and framing: follow the pose reference ({pose_p}).",
        ]
        if extra_clean:
            instruction.append(f"Additional details: {extra_clean}.")
        instruction.append(
            "Keep the face natural and expressive, the outfit fitted to the body's motion, "
            "correct limb perspective and hand anatomy, and consistent lighting."
        )

        tags = [style, portrait_p, f"wearing {costume_kw}", pose_p]
        if extra_clean:
            tags.append(extra_clean)

        return (
            _pil_to_comfy_tensor(portrait_pil),
            _pil_to_comfy_tensor(costume_pil),
            _pil_to_comfy_tensor(pose_pil),
            _pil_to_comfy_tensor(composite),
            " ".join(instruction),
            ", ".join(tags),
        )


NODE_CLASS_MAPPINGS = {
    "PoseGalleryNode": PoseGalleryNode,
    "CostumeGalleryNode": CostumeGalleryNode,
    "PortraitGalleryNode": PortraitGalleryNode,
    "CharacterRecipeNode": CharacterRecipeNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PoseGalleryNode": "Pose Gallery (AI Reference)",
    "CostumeGalleryNode": "Costume Gallery (AI Reference)",
    "PortraitGalleryNode": "Portrait Gallery (AI Reference)",
    "CharacterRecipeNode": "Character Recipe 3-in-1 (AI Reference)",
}
