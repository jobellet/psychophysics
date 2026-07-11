"""
Bistable Colored Images Generator

This script creates bistable perception images by:
1. Taking two input images
2. Computing their contours or silhouettes
3. Coloring each foreground with complementary hues (or Ishihara dots/Dalmatian contrast)
4. Merging the colored results
5. Iteratively transforming lines into geometric colored blobs (or packing circles)

The result creates ambiguous images where attending to one color hue
makes the other image invisible, producing bistable perception.
"""

import argparse
import random
import numpy as np
import cv2
from typing import Tuple, Optional
from pathlib import Path
import colorsys
from scipy.spatial import Voronoi

CLIP_AVAILABLE = False
try:
    import torch
    import clip
    from PIL import Image
    CLIP_AVAILABLE = True
except ImportError:
    pass

_CLIP_MODEL = None
_CLIP_PREPROCESS = None

def get_clip_model():
    """Lazily load CLIP model and preprocessor."""
    global _CLIP_MODEL, _CLIP_PREPROCESS
    if _CLIP_MODEL is None and CLIP_AVAILABLE:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        _CLIP_MODEL, _CLIP_PREPROCESS = clip.load("ViT-B/32", device=device)
    return _CLIP_MODEL, _CLIP_PREPROCESS


def load_image(image_path: str) -> np.ndarray:
    """Load an image from file path and convert to grayscale."""
    image = cv2.imread(image_path, cv2.IMREAD_GRAYSCALE)
    if image is None:
        raise ValueError(f"Could not load image from {image_path}")
    return image


def crop_and_resize(img1: np.ndarray, img2: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    """
    Crop both images to center squares and resize them to the minimum dimension
    among their widths and heights.
    """
    h1, w1 = img1.shape[:2]
    h2, w2 = img2.shape[:2]
    
    # Target size is the minimum of all dimensions
    size = min(h1, w1, h2, w2)
    
    def center_crop_to_square(img: np.ndarray) -> np.ndarray:
        h, w = img.shape[:2]
        min_dim = min(h, w)
        start_y = (h - min_dim) // 2
        start_x = (w - min_dim) // 2
        return img[start_y:start_y+min_dim, start_x:start_x+min_dim]
    
    crop1 = center_crop_to_square(img1)
    crop2 = center_crop_to_square(img2)
    
    # Resize both to size x size
    res1 = cv2.resize(crop1, (size, size))
    res2 = cv2.resize(crop2, (size, size))
    return res1, res2


def compute_silhouette(image: np.ndarray, method: str = 'otsu', 
                       threshold_value: int = 127, block_size: int = 51, C: int = 10,
                       invert: bool = False) -> np.ndarray:
    """
    Compute a binary silhouette mask of the foreground.
    
    Returns:
        Binary mask (0 or 255)
    """
    if image.dtype != np.uint8:
        image = (image * 255).astype(np.uint8)
        
    h, w = image.shape
    corner_pixels = [float(image[0, 0]), float(image[0, w-1]), float(image[h-1, 0]), float(image[h-1, w-1])]
    avg_corner = sum(corner_pixels) / 4.0
    
    # If corners are light, foreground object is likely dark (so invert thresholding is correct)
    inv_flag = cv2.THRESH_BINARY_INV if avg_corner > 127 else cv2.THRESH_BINARY
    
    if method == 'otsu':
        blurred = cv2.GaussianBlur(image, (5, 5), 0)
        _, thresh = cv2.threshold(blurred, 0, 255, inv_flag + cv2.THRESH_OTSU)
    elif method == 'adaptive':
        block_size = max(3, block_size | 1)
        thresh = cv2.adaptiveThreshold(image, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                      inv_flag, block_size, C)
    else:  # manual
        _, thresh = cv2.threshold(image, threshold_value, 255, inv_flag)
        
    if invert:
        thresh = cv2.bitwise_not(thresh)
        
    # Morphological cleaning to fill small holes and remove small noise dots
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
    
    return thresh


def compute_contours(image: np.ndarray, threshold: float = 0.5, 
                     sigma: float = 1.0) -> np.ndarray:
    """
    Compute contours from an image using Canny edge detection.
    """
    # Normalize image to 0-1 range
    if image.dtype != np.float32:
        image = image.astype(np.float32) / 255.0
    
    # Apply Gaussian blur
    blurred = cv2.GaussianBlur(image, (0, 0), sigma)
    
    # Compute edges using Canny
    median_intensity = np.median(blurred)
    lower_thresh = int(max(0, median_intensity * (1 - threshold)) * 255)
    upper_thresh = int(min(1, median_intensity * (1 + threshold)) * 255)
    
    edges = cv2.Canny((blurred * 255).astype(np.uint8), 
                     lower_thresh, upper_thresh, apertureSize=3)
    
    return edges.astype(np.float32) / 255.0


def get_complementary_hues() -> Tuple[Tuple[float, float, float], 
                                        Tuple[float, float, float]]:
    """Generate two random complementary hues in HSV color space."""
    hue1 = random.random()
    hue2 = (hue1 + 0.5) % 1.0
    saturation = 0.9 + random.random() * 0.1  # 0.9-1.0
    value = 0.9 + random.random() * 0.1      # 0.9-1.0
    
    color1 = (hue1, saturation, value)
    color2 = (hue2, saturation, value)
    
    return color1, color2


def hsv_to_rgb(hsv_color: Tuple[float, float, float]) -> Tuple[float, float, float]:
    """Convert HSV color to RGB (all values in 0-1 range)."""
    h, s, v = hsv_color
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return (r, g, b)


def color_contours(contours: np.ndarray, color: Tuple[float, float, float],
                  background: Tuple[float, float, float] = (0, 0, 0)) -> np.ndarray:
    """Color contours with the specified color."""
    height, width = contours.shape
    rgb_image = np.zeros((height, width, 3), dtype=np.float32)
    
    # Set background
    rgb_image[:, :, 0] = background[0]
    rgb_image[:, :, 1] = background[1]
    rgb_image[:, :, 2] = background[2]
    
    # Apply color to contours
    for c in range(3):
        rgb_image[:, :, c] = np.where(contours > 0, color[c], rgb_image[:, :, c])
    
    return rgb_image


def merge_colored_contours(contours1: np.ndarray, color1: Tuple[float, float, float],
                          contours2: np.ndarray, color2: Tuple[float, float, float],
                          background: Tuple[float, float, float] = (0, 0, 0)) -> np.ndarray:
    """Merge two colored contour images into one."""
    height, width = contours1.shape
    merged = np.zeros((height, width, 3), dtype=np.float32)
    
    # Set background
    merged[:, :, 0] = background[0]
    merged[:, :, 1] = background[1]
    merged[:, :, 2] = background[2]
    
    # Apply first color to its contours
    for c in range(3):
        merged[:, :, c] = np.where(contours1 > 0, color1[c], merged[:, :, c])
    
    # Apply second color to its contours (overwrites where both exist)
    for c in range(3):
        merged[:, :, c] = np.where(contours2 > 0, color2[c], merged[:, :, c])
    
    return merged


def dilate_contours(contours: np.ndarray, kernel_size: int = 3) -> np.ndarray:
    """Dilate contours to make lines thicker."""
    kernel = np.ones((kernel_size, kernel_size), np.uint8)
    dilated = cv2.dilate((contours * 255).astype(np.uint8), kernel, iterations=1)
    return dilated.astype(np.float32) / 255.0


def dense_circle_packing(width: int, height: int, min_r: float, max_r: float,
                         padding: float = 1.0, max_attempts: int = 30000) -> list:
    """Pack circles of varying sizes inside the image bounds without overlaps using grid acceleration."""
    circles = []
    cell_size = max_r + padding
    grid_w = int(np.ceil(width / cell_size))
    grid_h = int(np.ceil(height / cell_size))
    grid = [[[] for _ in range(grid_w)] for _ in range(grid_h)]
    
    sizes = np.linspace(max_r, min_r, 10)
    attempts_per_size = max_attempts // len(sizes)
    
    for r in sizes:
        for _ in range(attempts_per_size):
            x = random.uniform(r + padding, width - r - padding)
            y = random.uniform(r + padding, height - r - padding)
            
            gcx = int(x / cell_size)
            gcy = int(y / cell_size)
            
            overlapping = False
            for dy in [-1, 0, 1]:
                for dx in [-1, 0, 1]:
                    ny, nx = gcy + dy, gcx + dx
                    if 0 <= ny < grid_h and 0 <= nx < grid_w:
                        for idx in grid[ny][nx]:
                            px, py, pr = circles[idx]
                            dist_sq = (x - px)**2 + (y - py)**2
                            if dist_sq < (r + pr + padding)**2:
                                overlapping = True
                                break
                    if overlapping:
                        break
                        
            if not overlapping:
                circles.append((x, y, r))
                grid[gcy][gcx].append(len(circles) - 1)
                
    return circles


def generate_ishihara_plate(mask1: np.ndarray, mask2: np.ndarray,
                            color1_hsv: Tuple[float, float, float],
                            color2_hsv: Tuple[float, float, float],
                            circles: list,
                            style: str = 'ishihara') -> np.ndarray:
    """Draw packed circles on canvas colored based on silhouette masks."""
    height, width = mask1.shape[:2]
    
    if style == 'dalmatian':
        canvas = np.zeros((height, width, 3), dtype=np.uint8)
    else:  # ishihara
        canvas = np.ones((height, width, 3), dtype=np.uint8) * 230
        
    for x, y, r in circles:
        cx = max(0, min(width - 1, int(x)))
        cy = max(0, min(height - 1, int(y)))
        
        in_m1 = mask1[cy, cx] > 0
        in_m2 = mask2[cy, cx] > 0
        
        if style == 'dalmatian':
            if in_m1 or in_m2:
                color = (255, 255, 255)
            else:
                color = (15, 15, 15)
        else:  # ishihara
            if in_m1 and not in_m2:
                h, s, v = color1_hsv
                h_var = (h + random.uniform(-0.03, 0.03)) % 1.0
                s_var = max(0.4, min(1.0, s + random.uniform(-0.15, 0.15)))
                v_var = max(0.4, min(1.0, v + random.uniform(-0.15, 0.15)))
                r_val, g_val, b_val = colorsys.hsv_to_rgb(h_var, s_var, v_var)
                color = (int(r_val * 255), int(g_val * 255), int(b_val * 255))
            elif in_m2 and not in_m1:
                h, s, v = color2_hsv
                h_var = (h + random.uniform(-0.03, 0.03)) % 1.0
                s_var = max(0.4, min(1.0, s + random.uniform(-0.15, 0.15)))
                v_var = max(0.4, min(1.0, v + random.uniform(-0.15, 0.15)))
                r_val, g_val, b_val = colorsys.hsv_to_rgb(h_var, s_var, v_var)
                color = (int(r_val * 255), int(g_val * 255), int(b_val * 255))
            elif in_m1 and in_m2:
                h, s, v = color1_hsv if random.random() < 0.5 else color2_hsv
                h_var = (h + random.uniform(-0.03, 0.03)) % 1.0
                s_var = max(0.4, min(1.0, s + random.uniform(-0.15, 0.15)))
                v_var = max(0.4, min(1.0, v + random.uniform(-0.15, 0.15)))
                r_val, g_val, b_val = colorsys.hsv_to_rgb(h_var, s_var, v_var)
                color = (int(r_val * 255), int(g_val * 255), int(b_val * 255))
            else:
                bg_h = random.uniform(0.08, 0.18)
                bg_s = random.uniform(0.1, 0.3)
                bg_v = random.uniform(0.4, 0.7)
                r_val, g_val, b_val = colorsys.hsv_to_rgb(bg_h, bg_s, bg_v)
                color = (int(r_val * 255), int(g_val * 255), int(b_val * 255))
                
        cv2.circle(canvas, (int(x), int(y)), int(r), color, -1, cv2.LINE_AA)
        
    return canvas.astype(np.float32) / 255.0



def generate_dashes_plate(mask1: np.ndarray, mask2: np.ndarray,
                          color1_hsv: Tuple[float, float, float],
                          color2_hsv: Tuple[float, float, float],
                          spacing: int = 12, thickness: int = 2, length: int = 10) -> np.ndarray:
    """Draw oriented packed dashes on grid with jitter grouped by orientation & color."""
    height, width = mask1.shape[:2]
    canvas = np.ones((height, width, 3), dtype=np.uint8) * 230
    
    # Generate points with jitter
    points = []
    for y in range(spacing, height - spacing, spacing):
        for x in range(spacing, width - spacing, spacing):
            jx = x + random.randint(-spacing//4, spacing//4)
            jy = y + random.randint(-spacing//4, spacing//4)
            points.append((jx, jy))
            
    for cx, cy in points:
        # Clamp to bounds
        cx = max(0, min(width - 1, cx))
        cy = max(0, min(height - 1, cy))
        
        in_m1 = mask1[cy, cx] > 0
        in_m2 = mask2[cy, cx] > 0
        
        if in_m1 and not in_m2:
            angle = 0  # Horizontal
            h, s, v = color1_hsv
            h_var = (h + random.uniform(-0.02, 0.02)) % 1.0
            color = [int(x * 255) for x in colorsys.hsv_to_rgb(h_var, s, v)]
        elif in_m2 and not in_m1:
            angle = 90  # Vertical
            h, s, v = color2_hsv
            h_var = (h + random.uniform(-0.02, 0.02)) % 1.0
            color = [int(x * 255) for x in colorsys.hsv_to_rgb(h_var, s, v)]
        elif in_m1 and in_m2:
            # Alternate orientations in overlap region
            if (cx + cy) % 2 == 0:
                angle = 0
                h, s, v = color1_hsv
            else:
                angle = 90
                h, s, v = color2_hsv
            h_var = (h + random.uniform(-0.02, 0.02)) % 1.0
            color = [int(x * 255) for x in colorsys.hsv_to_rgb(h_var, s, v)]
        else:
            angle = 45  # Background
            bg_h = random.uniform(0.08, 0.18)
            bg_s = random.uniform(0.1, 0.2)
            bg_v = random.uniform(0.5, 0.6)
            color = [int(x * 255) for x in colorsys.hsv_to_rgb(bg_h, bg_s, bg_v)]
            
        rad = np.radians(angle)
        dx = int(length / 2 * np.cos(rad))
        dy = int(length / 2 * np.sin(rad))
        
        p1 = (cx - dx, cy - dy)
        p2 = (cx + dx, cy + dy)
        cv2.line(canvas, p1, p2, color, thickness, cv2.LINE_AA)
        
    return canvas.astype(np.float32) / 255.0


def generate_voronoi_plate(mask1: np.ndarray, mask2: np.ndarray,
                           color1_hsv: Tuple[float, float, float],
                           color2_hsv: Tuple[float, float, float],
                           num_cells: int = 800) -> np.ndarray:
    """Generate a stained-glass Voronoi plate colored by silhouettes."""
    height, width = mask1.shape[:2]
    
    # Generate points inside bounds
    points = np.random.rand(num_cells, 2) * [width, height]
    
    # Add borders to avoid issues at edge
    margin = 50
    boundary = [
        [-margin, -margin], [-margin, height+margin], [width+margin, -margin], [width+margin, height+margin],
        [width/2, -margin], [width/2, height+margin], [-margin, height/2], [width+margin, height/2]
    ]
    points = np.vstack([points, boundary])
    
    vor = Voronoi(points)
    canvas = np.zeros((height, width, 3), dtype=np.uint8)
    
    for r in range(len(vor.point_region)):
        region_idx = vor.point_region[r]
        vertices_idx = vor.regions[region_idx]
        
        if not vertices_idx or -1 in vertices_idx:
            continue
            
        vertices = vor.vertices[vertices_idx].astype(np.int32)
        
        # Centroid
        centroid = np.mean(vertices, axis=0).astype(np.int32)
        cx, cy = centroid[0], centroid[1]
        
        if not (0 <= cx < width and 0 <= cy < height):
            continue
            
        in_m1 = mask1[cy, cx] > 0
        in_m2 = mask2[cy, cx] > 0
        
        if in_m1 and not in_m2:
            h, s, v = color1_hsv
            h_var = (h + random.uniform(-0.02, 0.02)) % 1.0
            r_val, g_val, b_val = colorsys.hsv_to_rgb(h_var, s, v)
            color = (int(r_val * 255), int(g_val * 255), int(b_val * 255))
        elif in_m2 and not in_m1:
            h, s, v = color2_hsv
            h_var = (h + random.uniform(-0.02, 0.02)) % 1.0
            r_val, g_val, b_val = colorsys.hsv_to_rgb(h_var, s, v)
            color = (int(r_val * 255), int(g_val * 255), int(b_val * 255))
        elif in_m1 and in_m2:
            # Overlap Cell: alternate randomly
            h, s, v = color1_hsv if random.random() < 0.5 else color2_hsv
            h_var = (h + random.uniform(-0.02, 0.02)) % 1.0
            r_val, g_val, b_val = colorsys.hsv_to_rgb(h_var, s, v)
            color = (int(r_val * 255), int(g_val * 255), int(b_val * 255))
        else:
            # Background
            bg_h = random.uniform(0.08, 0.18)
            bg_s = random.uniform(0.05, 0.15)
            bg_v = random.uniform(0.5, 0.6)
            r_val, g_val, b_val = colorsys.hsv_to_rgb(bg_h, bg_s, bg_v)
            color = (int(r_val * 255), int(g_val * 255), int(b_val * 255))
            
        cv2.fillPoly(canvas, [vertices], color)
        # Subtle cell boundary lines
        cv2.polylines(canvas, [vertices], True, (255, 255, 255), 1)
        
    return canvas.astype(np.float32) / 255.0


def generate_organic_blobs_plate(mask1: np.ndarray, mask2: np.ndarray,
                                 color1_hsv: Tuple[float, float, float],
                                 color2_hsv: Tuple[float, float, float],
                                 num_blobs: int = 1200,
                                 min_size: int = 4, max_size: int = 9) -> np.ndarray:
    """Generate a packed organic blob plate using randomly scaled and rotated ellipses."""
    height, width = mask1.shape[:2]
    canvas = np.ones((height, width, 3), dtype=np.uint8) * 230
    
    # Generate points inside bounds
    points = []
    for _ in range(num_blobs):
        x = random.randint(10, width - 10)
        y = random.randint(10, height - 10)
        points.append((x, y))
        
    for cx, cy in points:
        in_m1 = mask1[cy, cx] > 0
        in_m2 = mask2[cy, cx] > 0
        
        if in_m1 and not in_m2:
            h, s, v = color1_hsv
            h_var = (h + random.uniform(-0.02, 0.02)) % 1.0
            r_val, g_val, b_val = colorsys.hsv_to_rgb(h_var, s, v)
            color = (int(r_val * 255), int(g_val * 255), int(b_val * 255))
        elif in_m2 and not in_m1:
            h, s, v = color2_hsv
            h_var = (h + random.uniform(-0.02, 0.02)) % 1.0
            r_val, g_val, b_val = colorsys.hsv_to_rgb(h_var, s, v)
            color = (int(r_val * 255), int(g_val * 255), int(b_val * 255))
        elif in_m1 and in_m2:
            h, s, v = color1_hsv if random.random() < 0.5 else color2_hsv
            h_var = (h + random.uniform(-0.02, 0.02)) % 1.0
            r_val, g_val, b_val = colorsys.hsv_to_rgb(h_var, s, v)
            color = (int(r_val * 255), int(g_val * 255), int(b_val * 255))
        else:
            bg_h = random.uniform(0.08, 0.18)
            bg_s = random.uniform(0.05, 0.15)
            bg_v = random.uniform(0.5, 0.6)
            r_val, g_val, b_val = colorsys.hsv_to_rgb(bg_h, bg_s, bg_v)
            color = (int(r_val * 255), int(g_val * 255), int(b_val * 255))
            
        axes = (random.randint(min_size, max_size), random.randint(min_size, max_size))
        angle = random.randint(0, 360)
        cv2.ellipse(canvas, (cx, cy), axes, angle, 0, 360, color, -1, cv2.LINE_AA)
        
    return canvas.astype(np.float32) / 255.0


def create_blob_mask(shape: Tuple[int, int], center: Tuple[int, int],
                    size: int, irregularity: float = 0.0) -> np.ndarray:
    """Create a circular blob mask using localized sub-window for high speed."""
    height, width = shape
    cy, cx = center
    
    max_r = int(size * (1.0 + 0.5 * irregularity)) + 2
    y_min = max(0, cy - max_r)
    y_max = min(height, cy + max_r + 1)
    x_min = max(0, cx - max_r)
    x_max = min(width, cx + max_r + 1)
    
    if y_max <= y_min or x_max <= x_min:
        return np.zeros(shape, dtype=np.float32)
        
    yy, xx = np.meshgrid(np.arange(y_min, y_max), np.arange(x_min, x_max), indexing='ij')
    distance = np.sqrt((xx - cx)**2 + (yy - cy)**2)
    mask = distance <= size
    
    if irregularity > 0:
        noise = (yy * 0.1 + xx * 0.1 + yy * xx * 0.001) % 1.0
        distortion = irregularity * size * (noise - 0.5)
        mask = distance <= (size + distortion)
        
    full_mask = np.zeros(shape, dtype=np.float32)
    full_mask[y_min:y_max, x_min:x_max] = mask.astype(np.float32)
    return full_mask


def contours_to_blobs(contours: np.ndarray, target_blob_size: int, 
                     irregularity: float = 0.3) -> np.ndarray:
    """Transform contour lines into geometric colored blobs."""
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
        (contours * 255).astype(np.uint8), connectivity=8)
    
    height, width = contours.shape
    result = np.zeros_like(contours)
    
    for i in range(1, num_labels):
        area = stats[i, cv2.CC_STAT_AREA]
        centroid_x = int(centroids[i, 0])
        centroid_y = int(centroids[i, 1])
        
        component_blob_size = int(target_blob_size * (1 + np.log1p(area) / 100))
        component_blob_size = max(1, component_blob_size)
        
        blob_mask = create_blob_mask((height, width), 
                                     (centroid_y, centroid_x),
                                     component_blob_size, irregularity)
        result = np.maximum(result, blob_mask)
    
    return result


def iterative_blob_transformation(merged_contours: np.ndarray, 
                                   color1: Tuple[float, float, float],
                                   color2: Tuple[float, float, float],
                                   num_iterations: int = 5,
                                   initial_blob_size: int = 3,
                                   blob_growth_rate: float = 1.5,
                                   irregularity: float = 0.3,
                                   background: Tuple[float, float, float] = (0.5, 0.5, 0.5)) -> list:
    """Iteratively transform the merged contour image into blobs."""
    color_tolerance = 0.1
    
    diff1 = np.abs(merged_contours - color1)
    contours1 = np.all(diff1 < color_tolerance, axis=2).astype(np.float32)
    
    diff2 = np.abs(merged_contours - color2)
    contours2 = np.all(diff2 < color_tolerance, axis=2).astype(np.float32)
    
    transformation_steps = []
    current_blob_size = initial_blob_size
    
    for iteration in range(num_iterations):
        blobs1 = contours_to_blobs(contours1, current_blob_size, irregularity)
        blobs2 = contours_to_blobs(contours2, current_blob_size, irregularity)
        
        colored_blobs1 = color_contours(blobs1, color1, background)
        colored_blobs2 = color_contours(blobs2, color2, background)
        
        merged_blobs = merge_colored_contours(blobs1, color1, blobs2, color2, background)
        transformation_steps.append(merged_blobs.copy())
        
        contours1 = blobs1.copy()
        contours2 = blobs2.copy()
        
        current_blob_size = int(current_blob_size * blob_growth_rate)
    
    return transformation_steps


def generate_bistable_image(image1_path: str, image2_path: str,
                           output_path: Optional[str] = None,
                           mode: str = 'blobs',
                           # Contour/Blob parameters:
                           num_iterations: int = 5,
                           initial_blob_size: int = 3,
                           blob_growth_rate: float = 1.5,
                           irregularity: float = 0.3,
                           contour_threshold: float = 0.5,
                           contour_sigma: float = 1.0,
                           contour_threshold2: Optional[float] = None,
                           contour_sigma2: Optional[float] = None,
                           # Dot/Ishihara parameters:
                           seg_method: str = 'otsu',
                           seg_threshold: int = 127,
                           seg_block_size: int = 51,
                           seg_C: int = 10,
                           seg_invert: bool = False,
                           seg_method2: Optional[str] = None,
                           seg_threshold2: Optional[int] = None,
                           seg_block_size2: Optional[int] = None,
                           seg_C2: Optional[int] = None,
                           seg_invert2: Optional[bool] = None,
                           dot_min_r: float = 2.0,
                           dot_max_r: float = 10.0,
                           dot_padding: float = 1.0,
                           dot_style: str = 'ishihara',
                           # Dash parameters
                           dash_spacing: int = 12,
                           dash_thickness: int = 2,
                           dash_length: int = 10,
                           # Voronoi parameters
                           voronoi_cells: int = 800,
                           # Organic blobs parameters
                           organic_blobs_count: int = 1200,
                           organic_blobs_min: int = 4,
                           organic_blobs_max: int = 9,
                           background_color: Tuple[float, float, float] = (0.5, 0.5, 0.5),
                           color1_hsv: Optional[Tuple[float, float, float]] = None,
                           color2_hsv: Optional[Tuple[float, float, float]] = None) -> list:
    """Generate a bistable perception image from two input images."""
    image1 = load_image(image1_path)
    image2 = load_image(image2_path)
    
    image1, image2 = crop_and_resize(image1, image2)
    
    if color1_hsv is None or color2_hsv is None:
        color1_hsv, color2_hsv = get_complementary_hues()
    color1 = hsv_to_rgb(color1_hsv)
    color2 = hsv_to_rgb(color2_hsv)
    
    if mode in ['dots', 'dashes', 'voronoi', 'organic_blobs']:
        sm1 = seg_method
        sm2 = seg_method2 if seg_method2 is not None else seg_method
        st1 = seg_threshold
        st2 = seg_threshold2 if seg_threshold2 is not None else seg_threshold
        sb1 = seg_block_size
        sb2 = seg_block_size2 if seg_block_size2 is not None else seg_block_size
        sc1 = seg_C
        sc2 = seg_C2 if seg_C2 is not None else seg_C
        si1 = seg_invert
        si2 = seg_invert2 if seg_invert2 is not None else seg_invert

        mask1 = compute_silhouette(image1, method=sm1, threshold_value=st1, block_size=sb1, C=sc1, invert=si1)
        mask2 = compute_silhouette(image2, method=sm2, threshold_value=st2, block_size=sb2, C=sc2, invert=si2)
        
        h, w = mask1.shape[:2]
        if mode == 'dots':
            circles = dense_circle_packing(w, h, dot_min_r, dot_max_r, dot_padding)
            plate = generate_ishihara_plate(mask1, mask2, color1_hsv, color2_hsv, circles, style=dot_style)
        elif mode == 'dashes':
            plate = generate_dashes_plate(mask1, mask2, color1_hsv, color2_hsv,
                                          spacing=dash_spacing, thickness=dash_thickness, length=dash_length)
        elif mode == 'voronoi':
            plate = generate_voronoi_plate(mask1, mask2, color1_hsv, color2_hsv, num_cells=voronoi_cells)
        else:  # organic_blobs
            plate = generate_organic_blobs_plate(mask1, mask2, color1_hsv, color2_hsv,
                                                 num_blobs=organic_blobs_count, min_size=organic_blobs_min, max_size=organic_blobs_max)
        
        merged_silhouettes = merge_colored_contours(mask1 / 255.0, color1, mask2 / 255.0, color2, background_color)
        steps = [merged_silhouettes, plate]
        
        if output_path:
            final_image = steps[-1]
            final_image_uint8 = (final_image * 255).astype(np.uint8)
            cv2.imwrite(output_path, cv2.cvtColor(final_image_uint8, cv2.COLOR_RGB2BGR))
            print(f"Saved final image to {output_path}")
            
        return steps
        
    else:  # blobs mode
        ct1 = contour_threshold
        ct2 = contour_threshold2 if contour_threshold2 is not None else contour_threshold
        cs1 = contour_sigma
        cs2 = contour_sigma2 if contour_sigma2 is not None else contour_sigma

        contours1 = compute_contours(image1, ct1, cs1)
        contours2 = compute_contours(image2, ct2, cs2)
        
        colored_contours1 = color_contours(contours1, color1, background_color)
        colored_contours2 = color_contours(contours2, color2, background_color)
        
        merged_contours = merge_colored_contours(contours1, color1, contours2, color2, background_color)
        
        transformation_steps = iterative_blob_transformation(
            merged_contours, color1, color2,
            num_iterations=num_iterations,
            initial_blob_size=initial_blob_size,
            blob_growth_rate=blob_growth_rate,
            irregularity=irregularity,
            background=background_color
        )
        
        transformation_steps.insert(0, merged_contours)
        
        if output_path:
            final_image = transformation_steps[-1]
            final_image_uint8 = (final_image * 255).astype(np.uint8)
            cv2.imwrite(output_path, cv2.cvtColor(final_image_uint8, cv2.COLOR_RGB2BGR))
            print(f"Saved final image to {output_path}")
        
        return transformation_steps


def save_transformation_sequence(images: list, output_prefix: str, 
                                 output_dir: str = "output") -> list:
    """Save a sequence of transformation images."""
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    saved_paths = []
    
    for i, image in enumerate(images):
        filename = f"{output_prefix}_step_{i:03d}.png"
        filepath = Path(output_dir) / filename
        
        image_uint8 = (image * 255).astype(np.uint8)
        cv2.imwrite(str(filepath), cv2.cvtColor(image_uint8, cv2.COLOR_RGB2BGR))
        saved_paths.append(str(filepath))
        print(f"Saved: {filepath}")
    
    return saved_paths


def optimize_segmentation_with_clip(img_path: str, mode: str, color_hsv: Tuple[float, float, float],
                                    background_color: Tuple[float, float, float] = (0.5, 0.5, 0.5)) -> dict:
    """Optimize contour or silhouette segmentation parameters using CLIP similarity."""
    if not CLIP_AVAILABLE:
        raise RuntimeError("CLIP is not available in the current environment.")
        
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, preprocess = get_clip_model()
    
    # Pre-encode original image
    orig_pil = Image.open(img_path)
    orig_tensor = preprocess(orig_pil).unsqueeze(0).to(device)
    with torch.no_grad():
        orig_features = model.encode_image(orig_tensor)
        orig_features /= orig_features.norm(dim=-1, keepdim=True)
        
    image = load_image(img_path)
    best_score = -1.0
    best_params = {}
    color_rgb = hsv_to_rgb(color_hsv)
    
    if mode in ['dots', 'dashes', 'voronoi', 'organic_blobs']:
        candidates = []
        # Otsu
        for inv in [False, True]:
            candidates.append({'seg_method': 'otsu', 'seg_threshold': 127, 'seg_block_size': 51, 'seg_C': 10, 'seg_invert': inv})
        # Manual threshold
        for thresh in [60, 100, 140, 180, 220]:
            for inv in [False, True]:
                candidates.append({'seg_method': 'manual', 'seg_threshold': thresh, 'seg_block_size': 51, 'seg_C': 10, 'seg_invert': inv})
        # Adaptive
        for b_size in [31, 71]:
            for C_val in [5, 12]:
                for inv in [False, True]:
                    candidates.append({'seg_method': 'adaptive', 'seg_threshold': 127, 'seg_block_size': b_size, 'seg_C': C_val, 'seg_invert': inv})
                    
        for p in candidates:
            mask = compute_silhouette(image, method=p['seg_method'], threshold_value=p['seg_threshold'],
                                     block_size=p['seg_block_size'], C=p['seg_C'], invert=p['seg_invert'])
            candidate_img = color_contours(mask / 255.0, color_rgb, background_color)
            candidate_pil = Image.fromarray((candidate_img * 255).astype(np.uint8))
            
            candidate_tensor = preprocess(candidate_pil).unsqueeze(0).to(device)
            with torch.no_grad():
                candidate_features = model.encode_image(candidate_tensor)
                candidate_features /= candidate_features.norm(dim=-1, keepdim=True)
                
            sim = (orig_features * candidate_features).sum().item()
            if sim > best_score:
                best_score = sim
                best_params = p
                
    else:  # blobs mode
        thresholds = [0.1, 0.3, 0.5, 0.7, 0.9]
        sigmas = [0.5, 1.0, 2.0, 3.0]
        
        for thresh in thresholds:
            for sig in sigmas:
                contours = compute_contours(image, thresh, sig)
                candidate_img = color_contours(contours, color_rgb, background_color)
                candidate_pil = Image.fromarray((candidate_img * 255).astype(np.uint8))
                
                candidate_tensor = preprocess(candidate_pil).unsqueeze(0).to(device)
                with torch.no_grad():
                    candidate_features = model.encode_image(candidate_tensor)
                    candidate_features /= candidate_features.norm(dim=-1, keepdim=True)
                    
                sim = (orig_features * candidate_features).sum().item()
                if sim > best_score:
                    best_score = sim
                    best_params = {'threshold': thresh, 'sigma': sig}
                    
    return best_params


def optimize_generation_with_clip(image1_path: str, image2_path: str, mode: str,
                                   color1_hsv: Tuple[float, float, float],
                                   color2_hsv: Tuple[float, float, float],
                                   best_seg1: dict, best_seg2: dict,
                                   background_color: Tuple[float, float, float] = (0.5, 0.5, 0.5)) -> dict:
    """Optimize circle packing or blob growth parameters to maximize balanced similarity to both inputs."""
    if not CLIP_AVAILABLE:
        raise RuntimeError("CLIP is not available in the current environment.")
        
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, preprocess = get_clip_model()
    
    orig1_pil = Image.open(image1_path)
    orig1_tensor = preprocess(orig1_pil).unsqueeze(0).to(device)
    
    orig2_pil = Image.open(image2_path)
    orig2_tensor = preprocess(orig2_pil).unsqueeze(0).to(device)
    
    with torch.no_grad():
        features1 = model.encode_image(orig1_tensor)
        features1 /= features1.norm(dim=-1, keepdim=True)
        
        features2 = model.encode_image(orig2_tensor)
        features2 /= features2.norm(dim=-1, keepdim=True)
        
    best_score = -1.0
    best_params = {}
    
    # Helper parameters for silhouette mode calls
    seg_kwargs = {
        'seg_method': best_seg1.get('seg_method', 'otsu'),
        'seg_threshold': best_seg1.get('seg_threshold', 127),
        'seg_block_size': best_seg1.get('seg_block_size', 51),
        'seg_C': best_seg1.get('seg_C', 10),
        'seg_invert': best_seg1.get('seg_invert', False),
        'seg_method2': best_seg2.get('seg_method', 'otsu'),
        'seg_threshold2': best_seg2.get('seg_threshold', 127),
        'seg_block_size2': best_seg2.get('seg_block_size', 51),
        'seg_C2': best_seg2.get('seg_C', 10),
        'seg_invert2': best_seg2.get('seg_invert', False),
        'background_color': background_color,
        'color1_hsv': color1_hsv,
        'color2_hsv': color2_hsv
    }

    if mode == 'dots':
        min_rs = [1.5, 3.0, 5.0]
        max_rs = [8.0, 14.0, 22.0]
        paddings = [0.5, 1.0, 2.0]
        
        for min_r in min_rs:
            for max_r in max_rs:
                if max_r <= min_r:
                    continue
                for padding in paddings:
                    steps = generate_bistable_image(
                        image1_path, image2_path, output_path=None, mode='dots',
                        dot_min_r=min_r, dot_max_r=max_r, dot_padding=padding,
                        dot_style='ishihara', **seg_kwargs
                    )
                    plate_img = steps[-1]
                    plate_pil = Image.fromarray((plate_img * 255).astype(np.uint8))
                    
                    plate_tensor = preprocess(plate_pil).unsqueeze(0).to(device)
                    with torch.no_grad():
                        plate_features = model.encode_image(plate_tensor)
                        plate_features /= plate_features.norm(dim=-1, keepdim=True)
                        
                    sim1 = (features1 * plate_features).sum().item()
                    sim2 = (features2 * plate_features).sum().item()
                    
                    score = min(sim1, sim2) + 0.5 * (sim1 + sim2)
                    if score > best_score:
                        best_score = score
                        best_params = {'dot_min_r': min_r, 'dot_max_r': max_r, 'dot_padding': padding}
    elif mode == 'dashes':
        spacings = [10, 14, 18]
        thicknesses = [1, 2, 3]
        lengths = [8, 12, 16]
        for sp in spacings:
            for th in thicknesses:
                for le in lengths:
                    steps = generate_bistable_image(
                        image1_path, image2_path, output_path=None, mode='dashes',
                        dash_spacing=sp, dash_thickness=th, dash_length=le, **seg_kwargs
                    )
                    plate_img = steps[-1]
                    plate_pil = Image.fromarray((plate_img * 255).astype(np.uint8))
                    
                    plate_tensor = preprocess(plate_pil).unsqueeze(0).to(device)
                    with torch.no_grad():
                        plate_features = model.encode_image(plate_tensor)
                        plate_features /= plate_features.norm(dim=-1, keepdim=True)
                        
                    sim1 = (features1 * plate_features).sum().item()
                    sim2 = (features2 * plate_features).sum().item()
                    
                    score = min(sim1, sim2) + 0.5 * (sim1 + sim2)
                    if score > best_score:
                        best_score = score
                        best_params = {'dash_spacing': sp, 'dash_thickness': th, 'dash_length': le}
    elif mode == 'voronoi':
        cells_list = [400, 800, 1200]
        for cells in cells_list:
            steps = generate_bistable_image(
                image1_path, image2_path, output_path=None, mode='voronoi',
                voronoi_cells=cells, **seg_kwargs
            )
            plate_img = steps[-1]
            plate_pil = Image.fromarray((plate_img * 255).astype(np.uint8))
            
            plate_tensor = preprocess(plate_pil).unsqueeze(0).to(device)
            with torch.no_grad():
                plate_features = model.encode_image(plate_tensor)
                plate_features /= plate_features.norm(dim=-1, keepdim=True)
                
            sim1 = (features1 * plate_features).sum().item()
            sim2 = (features2 * plate_features).sum().item()
            
            score = min(sim1, sim2) + 0.5 * (sim1 + sim2)
            if score > best_score:
                best_score = score
                best_params = {'voronoi_cells': cells}
    elif mode == 'organic_blobs':
        counts = [800, 1200, 1600]
        mins = [3, 5]
        maxs = [8, 12]
        for cnt in counts:
            for mn in mins:
                for mx in maxs:
                    steps = generate_bistable_image(
                        image1_path, image2_path, output_path=None, mode='organic_blobs',
                        organic_blobs_count=cnt, organic_blobs_min=mn, organic_blobs_max=mx, **seg_kwargs
                    )
                    plate_img = steps[-1]
                    plate_pil = Image.fromarray((plate_img * 255).astype(np.uint8))
                    
                    plate_tensor = preprocess(plate_pil).unsqueeze(0).to(device)
                    with torch.no_grad():
                        plate_features = model.encode_image(plate_tensor)
                        plate_features /= plate_features.norm(dim=-1, keepdim=True)
                        
                    sim1 = (features1 * plate_features).sum().item()
                    sim2 = (features2 * plate_features).sum().item()
                    
                    score = min(sim1, sim2) + 0.5 * (sim1 + sim2)
                    if score > best_score:
                        best_score = score
                        best_params = {'organic_blobs_count': cnt, 'organic_blobs_min': mn, 'organic_blobs_max': mx}
    else:  # blobs mode
        iters = [3, 5, 7]
        blob_sizes = [2, 4]
        growth_rates = [1.3, 1.6]
        irregularities = [0.2, 0.5]
        
        for num_iter in iters:
            for b_size in blob_sizes:
                for growth in growth_rates:
                    for irreg in irregularities:
                        steps = generate_bistable_image(
                            image1_path, image2_path, output_path=None, mode='blobs',
                            num_iterations=num_iter, initial_blob_size=b_size,
                            blob_growth_rate=growth, irregularity=irreg,
                            contour_threshold=best_seg1.get('threshold', 0.5),
                            contour_sigma=best_seg1.get('sigma', 1.0),
                            contour_threshold2=best_seg2.get('threshold', 0.5),
                            contour_sigma2=best_seg2.get('sigma', 1.0),
                            background_color=background_color,
                            color1_hsv=color1_hsv, color2_hsv=color2_hsv
                        )
                        output_img = steps[-1]
                        output_pil = Image.fromarray((output_img * 255).astype(np.uint8))
                        
                        output_tensor = preprocess(output_pil).unsqueeze(0).to(device)
                        with torch.no_grad():
                            output_features = model.encode_image(output_tensor)
                            output_features /= output_features.norm(dim=-1, keepdim=True)
                            
                        sim1 = (features1 * output_features).sum().item()
                        sim2 = (features2 * output_features).sum().item()
                        
                        score = min(sim1, sim2) + 0.5 * (sim1 + sim2)
                        if score > best_score:
                            best_score = score
                            best_params = {
                                'iterations': num_iter,
                                'blob_size': b_size,
                                'growth_rate': growth,
                                'irregularity': irreg
                            }
                            
    return best_params


def main():
    parser = argparse.ArgumentParser(
        description="Generate bistable colored images from two input images"
    )
    parser.add_argument("--image1", required=True, help="Path to first input image")
    parser.add_argument("--image2", required=True, help="Path to second input image")
    parser.add_argument("--output", default="bistable_output.png", 
                       help="Output path for final image")
    parser.add_argument("--output-dir", default="output",
                       help="Directory to save transformation sequence")
    parser.add_argument("--iterations", type=int, default=5,
                       help="Number of blob transformation iterations")
    parser.add_argument("--blob-size", type=int, default=3,
                       help="Initial blob size")
    parser.add_argument("--growth-rate", type=float, default=1.5,
                       help="Blob growth rate per iteration")
    parser.add_argument("--irregularity", type=float, default=0.3,
                       help="Blob shape irregularity (0-1)")
    parser.add_argument("--threshold", type=float, default=0.5,
                       help="Edge detection threshold")
    parser.add_argument("--sigma", type=float, default=1.0,
                       help="Gaussian blur sigma for edge detection")
    parser.add_argument("--mode", default="blobs", choices=["blobs", "dots", "dashes", "voronoi", "organic_blobs"],
                        help="Stimulus generation mode: blobs, dots, dashes, voronoi, or organic_blobs")
    parser.add_argument("--seg-method", default="otsu", choices=["otsu", "adaptive", "manual"],
                        help="Segmentation method for dots/silhouette modes")
    parser.add_argument("--seg-threshold", type=int, default=127,
                        help="Threshold for manual segmentation (0-255)")
    parser.add_argument("--seg-block-size", type=int, default=51,
                        help="Neighborhood block size for adaptive segmentation")
    parser.add_argument("--seg-C", type=int, default=10,
                        help="Constant subtracted from mean for adaptive segmentation")
    parser.add_argument("--seg-invert", action="store_true",
                        help="Invert the binary segmentation masks")
    parser.add_argument("--dot-min-r", type=float, default=2.0,
                        help="Minimum circle radius for dots mode")
    parser.add_argument("--dot-max-r", type=float, default=10.0,
                        help="Maximum circle radius for dots mode")
    parser.add_argument("--dot-padding", type=float, default=1.0,
                        help="Padding between circles in dots mode")
    parser.add_argument("--dot-style", default="ishihara", choices=["ishihara", "dalmatian"],
                        help="Visual styling for the dots mode")
    # New options
    parser.add_argument("--dash-spacing", type=int, default=12,
                        help="Spacing between dashes for dashes mode")
    parser.add_argument("--dash-thickness", type=int, default=2,
                        help="Thickness of dashes for dashes mode")
    parser.add_argument("--dash-length", type=int, default=10,
                        help="Length of dashes for dashes mode")
    parser.add_argument("--voronoi-cells", type=int, default=800,
                        help="Number of Voronoi cells for voronoi mode")
    parser.add_argument("--organic-blobs-count", type=int, default=1200,
                        help="Number of organic blobs")
    parser.add_argument("--organic-blobs-min", type=int, default=4,
                        help="Minimum size of organic blobs")
    parser.add_argument("--organic-blobs-max", type=int, default=9,
                        help="Maximum size of organic blobs")
    parser.add_argument("--optimize-clip", action="store_true",
                        help="Optimize parameters with CLIP model")
    parser.add_argument("--save-sequence", action="store_true",
                        help="Save all transformation steps")
    
    args = parser.parse_args()
    
    # Generate random hues
    hsv_color1, hsv_color2 = get_complementary_hues()
    
    seg_args = {}
    if args.optimize_clip:
        if not CLIP_AVAILABLE:
            print("CLIP is not available in the current environment! Skipping optimization.")
        else:
            print("Optimizing parameters with CLIP...")
            best_s1 = optimize_segmentation_with_clip(args.image1, args.mode, hsv_color1)
            best_s2 = optimize_segmentation_with_clip(args.image2, args.mode, hsv_color2)
            print(f"Optimal Image 1 segmentation parameters: {best_s1}")
            print(f"Optimal Image 2 segmentation parameters: {best_s2}")
            
            # Map parameters
            if args.mode in ['dots', 'dashes', 'voronoi', 'organic_blobs']:
                seg_args.update({
                    'seg_method': best_s1['seg_method'], 'seg_threshold': best_s1['seg_threshold'],
                    'seg_block_size': best_s1['seg_block_size'], 'seg_C': best_s1['seg_C'],
                    'seg_invert': best_s1['seg_invert'],
                    'seg_method2': best_s2['seg_method'], 'seg_threshold2': best_s2['seg_threshold'],
                    'seg_block_size2': best_s2['seg_block_size'], 'seg_C2': best_s2['seg_C'],
                    'seg_invert2': best_s2['seg_invert'],
                })
            else:
                seg_args.update({
                    'contour_threshold': best_s1['threshold'], 'contour_sigma': best_s1['sigma'],
                    'contour_threshold2': best_s2['threshold'], 'contour_sigma2': best_s2['sigma'],
                })
                
            best_gen = optimize_generation_with_clip(args.image1, args.image2, args.mode, hsv_color1, hsv_color2, best_s1, best_s2)
            print(f"Optimal generation parameters: {best_gen}")
            seg_args.update(best_gen)
            
    # Compile arguments
    params = {
        'output_path': args.output,
        'mode': args.mode,
        'num_iterations': args.iterations,
        'initial_blob_size': args.blob_size,
        'blob_growth_rate': args.growth_rate,
        'irregularity': args.irregularity,
        'contour_threshold': args.threshold,
        'contour_sigma': args.sigma,
        'seg_method': args.seg_method,
        'seg_threshold': args.seg_threshold,
        'seg_block_size': args.seg_block_size,
        'seg_C': args.seg_C,
        'seg_invert': args.seg_invert,
        'dot_min_r': args.dot_min_r,
        'dot_max_r': args.dot_max_r,
        'dot_padding': args.dot_padding,
        'dot_style': args.dot_style,
        'dash_spacing': args.dash_spacing,
        'dash_thickness': args.dash_thickness,
        'dash_length': args.dash_length,
        'voronoi_cells': args.voronoi_cells,
        'organic_blobs_count': args.organic_blobs_count,
        'organic_blobs_min': args.organic_blobs_min,
        'organic_blobs_max': args.organic_blobs_max,
        'color1_hsv': hsv_color1,
        'color2_hsv': hsv_color2,
    }
    # Apply optimal CLIP values if optimized
    params.update(seg_args)
    
    transformation_steps = generate_bistable_image(args.image1, args.image2, **params)
    
    if args.save_sequence:
        output_prefix = Path(args.output).stem
        save_transformation_sequence(
            transformation_steps, 
            output_prefix, 
            args.output_dir
        )
    
    print(f"Generated {len(transformation_steps)} steps")
    print(f"Final image saved to {args.output}")


if __name__ == "__main__":
    main()
