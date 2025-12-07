
import os
import clip
import faiss
import torch
import numpy as np
from PIL import Image
from pathlib import Path


# Global CLIP model (loaded once)
_clip_model = None
_clip_preprocess = None
_clip_device = None


def load_clip_model():
   
    global _clip_model, _clip_preprocess, _clip_device
    
    if _clip_model is None:
        _clip_device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"    Loading CLIP model on {_clip_device}...")
        _clip_model, _clip_preprocess = clip.load("ViT-B/32", device=_clip_device)
        print(f"    CLIP model loaded")
    
    return _clip_model, _clip_preprocess, _clip_device


def get_embedding(image_path, model=None, preprocess=None, device=None):
    """
    Get CLIP embedding for an image.
    
    Args:
        image_path: Path to image file
    
    Returns:
        numpy array: Image embedding vector
    """
    if model is None or preprocess is None or device is None:
        model, preprocess, device = load_clip_model()
    
    try:
        image = Image.open(image_path).convert('RGB')
        image_tensor = preprocess(image).unsqueeze(0).to(device)
        
        with torch.no_grad():
            embedding = model.encode_image(image_tensor)
        
        return embedding.cpu().numpy().flatten()
    except Exception as e:
        print(f"   Error getting embedding for {image_path}: {e}")
        return None


def cosine_similarity(a, b):
    """
    Calculate cosine similarity between two vectors.
    
    Args:
        a, b: numpy arrays
    
    Returns:
        float: Cosine similarity (0-1)
    """
    a_norm = a / np.linalg.norm(a)
    b_norm = b / np.linalg.norm(b)
    return np.dot(a_norm, b_norm)


def confidence_score(similarity):
    """Convert similarity to confidence score (0-100)"""
    return float(max(0.0, min(1.0, similarity)) * 100)


def confidence_label(score):
    """Get human-readable confidence label"""
    if score > 95:
        return "Extremely likely the same image"
    elif score > 90:
        return "Very likely the same image"
    elif score > 85:
        return "Possibly the same image"
    else:
        return "Unlikely to be the same image"


def compare_images_clip(original_image_path, search_result_paths, similarity_threshold=0.85):
    """
    Compare original image with search results using CLIP.
    
    Args:
        original_image_path: Path to original image
        search_result_paths: List of paths to search result images
        similarity_threshold: Minimum similarity for match (0-1)

    """
    if not os.path.exists(original_image_path):
        return {
            'exact_matches': 0,
            'total_compared': 0,
            'is_dropshipping': False,
            'match_ratio': 0.0,
            'similarities': [],
            'match_details': []
        }
    
    # Load CLIP model
    model, preprocess, device = load_clip_model()
    
    # Get embedding for original image
    original_embedding = get_embedding(original_image_path, model, preprocess, device)
    if original_embedding is None:
        return {
            'exact_matches': 0,
            'total_compared': 0,
            'is_dropshipping': False,
            'match_ratio': 0.0,
            'similarities': [],
            'match_details': []
        }
    
    exact_matches = 0
    total_compared = 0
    similarities = []
    match_details = []
    
    # Compare with each search result
    for result_path in search_result_paths:
        if not os.path.exists(result_path):
            continue
        
        try:
            result_embedding = get_embedding(result_path, model, preprocess, device)
            if result_embedding is None:
                continue
            
            # Calculate similarity
            sim = cosine_similarity(original_embedding, result_embedding)
            similarities.append(sim)
            total_compared += 1
            
            score = confidence_score(sim)
            label = confidence_label(score)
            
            match_details.append({
                'path': result_path,
                'similarity': float(sim),
                'confidence': score,
                'label': label
            })
            
            if sim >= similarity_threshold:
                exact_matches += 1
                print(f" Match found: {os.path.basename(result_path)} (similarity: {sim:.4f}, confidence: {score:.2f}%)")
        
        except Exception as e:
            print(f"    Error comparing {result_path}: {e}")
            continue
    
    match_ratio = exact_matches / total_compared if total_compared > 0 else 0.0
    is_dropshipping = exact_matches > 0
    
    return {
        'exact_matches': exact_matches,
        'total_compared': total_compared,
        'is_dropshipping': is_dropshipping,
        'match_ratio': match_ratio,
        'similarities': similarities,
        'match_details': match_details,
        'avg_similarity': np.mean(similarities) if similarities else 0.0
    }


def build_faiss_index(embeddings):
    """
    Build FAISS index for fast similarity search.
    
    Args:
        embeddings: numpy array of embeddings
    
    Returns:
        faiss.Index: FAISS index
    """
    dimension = embeddings.shape[1]
    index = faiss.IndexFlatL2(dimension)
    index.add(embeddings.astype('float32'))
    return index


def reverse_image_search_clip(image_folder, query_image, top_k=5):
    """
    Perform reverse image search using CLIP and FAISS.
    
    Args:
        image_folder: Folder containing images to search in
        query_image: Path to query image
        top_k: Number of top matches to return
    
    Returns:
        list: List of match dictionaries with paths and similarities
    """
    model, preprocess, device = load_clip_model()
    
    # Get embeddings for all images in folder
    embeddings = []
    paths = []
    
    print(f"    Processing images in {image_folder}...")
    for filename in os.listdir(image_folder):
        if filename.lower().endswith((".jpg", ".png", ".jpeg")):
            full_path = os.path.join(image_folder, filename)
            emb = get_embedding(full_path, model, preprocess, device)
            if emb is not None:
                embeddings.append(emb)
                paths.append(full_path)
    
    if not embeddings:
        print("     No valid images found in folder")
        return []
    
    embeddings = np.vstack(embeddings)
    
    # Build FAISS index
    index = build_faiss_index(embeddings)
    
    # Get query embedding
    query_embedding = get_embedding(query_image, model, preprocess, device)
    if query_embedding is None:
        return []
    
    query_vec = query_embedding.reshape(1, -1).astype('float32')
    
    # Search
    distances, indices = index.search(query_vec, min(top_k, len(paths)))
    
    results = []
    for rank, idx in enumerate(indices[0]):
        candidate_path = paths[idx]
        candidate_vec = embeddings[idx]
        sim = cosine_similarity(query_embedding, candidate_vec)
        score = confidence_score(sim)
        label = confidence_label(score)
        
        results.append({
            'rank': rank + 1,
            'path': candidate_path,
            'similarity': float(sim),
            'confidence': score,
            'label': label,
            'distance': float(distances[0][rank])
        })
    
    return results

