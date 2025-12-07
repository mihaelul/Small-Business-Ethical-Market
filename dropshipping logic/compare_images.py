import os
from pathlib import Path
from clip_comparison import compare_images_clip, get_embedding, cosine_similarity, confidence_score, confidence_label
import json


def compare_original_with_downloaded(original_folder="data/original", downloaded_folder="data/downloaded", similarity_threshold=0.60):
    """
    Compară fiecare imagine din original cu toate imaginile descărcate.
    
    Args:
        original_folder: Folder cu imaginile originale
        downloaded_folder: Folder cu imaginile descărcate
        similarity_threshold: Prag minim de similaritate pentru a considera o potrivire
    
    Returns:
        dict: Rezultatele comparatiei
    """
    original_path = Path(original_folder)
    downloaded_path = Path(downloaded_folder)
    
    if not original_path.exists():
        print(f" Folderul original nu exista: {original_folder}")
        return {}
    
    if not downloaded_path.exists():
        print(f" Folderul cu imagini descărcate nu exista: {downloaded_folder}")
        return {}
    
    # Get all original images
    image_extensions = ['.jpg', '.jpeg', '.png', '.JPG', '.JPEG', '.PNG']
    original_images = [
        f for f in original_path.iterdir()
        if f.is_file() and f.suffix.lower() in image_extensions
    ]
    
    # Get all downloaded images
    downloaded_images = [
        f for f in downloaded_path.iterdir()
        if f.is_file() and f.suffix.lower() in image_extensions
    ]
    
    if not original_images:
        print(f" Nu s-au găsit imagini în {original_folder}")
        return {}
    
    if not downloaded_images:
        print(f" Nu s-au găsit imagini în {downloaded_folder}")
        return {}
    
    print(f"\n Comparare imagini")
    print("=" * 60)
    print(f" Original: {len(original_images)} imagini")
    print(f" Descărcate: {len(downloaded_images)} imagini")
    print(f" Prag similaritate: {similarity_threshold*100:.0f}%")
    print("=" * 60)
    
    results = {}
    
    # Compare each original image with all downloaded images
    for orig_img in original_images:
        orig_name = orig_img.name
        print(f"\n Analizand: {orig_name}")
        
     
        downloaded_paths = [str(img) for img in downloaded_images]
        
        # Compare using CLIP
        comparison = compare_images_clip(
            str(orig_img),
            downloaded_paths,
            similarity_threshold=similarity_threshold
        )
        
        # Get top matches
        match_details = comparison.get('match_details', [])
     
        match_details.sort(key=lambda x: x['similarity'], reverse=True)
        
        # Keep only matches above threshold
        top_matches = [
            match for match in match_details 
            if match['similarity'] >= similarity_threshold
        ][:10] 
        
        results[orig_name] = {
            'original_path': str(orig_img),
            'total_compared': comparison['total_compared'],
            'exact_matches': comparison['exact_matches'],
            'match_ratio': comparison['match_ratio'],
            'avg_similarity': comparison['avg_similarity'],
            'top_matches': top_matches
        }
        
        # Print summary
        print(f"    Comparat cu {comparison['total_compared']} imagini")
        print(f"    Potriviri gasite: {comparison['exact_matches']}")
        print(f"    Similaritate medie: {comparison['avg_similarity']:.4f}")
        
        if top_matches:
            print(f"    Top {len(top_matches)} potriviri:")
            for idx, match in enumerate(top_matches[:5], 1):  # Show top 5
                print(f"      {idx}. {Path(match['path']).name}")
                print(f"         Similaritate: {match['similarity']:.4f} ({match['confidence']:.2f}%)")
                print(f"         Verdict: {match['label']}")
        else:
            print(f"     Nu s-au gasit potriviri peste {similarity_threshold*100:.0f}%")
    
    return results


def print_summary(results):
    """Afiseaza un rezumat al rezultatelor"""
    if not results:
        print("\n Nu exista rezultate de afisat")
        return
    
    print("\n" + "=" * 60)
    print("📋 REZUMAT COMPARATIE")
    print("=" * 60)
    
    total_originals = len(results)
    total_with_matches = sum(1 for r in results.values() if r['exact_matches'] > 0)
    total_matches = sum(r['exact_matches'] for r in results.values())
    avg_similarity = sum(r['avg_similarity'] for r in results.values()) / total_originals if total_originals > 0 else 0
    
    print(f"\n Statistici generale:")
    print(f"   Imagini originale analizate: {total_originals}")
    print(f"   Imagini cu potriviri: {total_with_matches} ({total_with_matches/total_originals*100:.1f}%)")
    print(f"   Total potriviri gasite: {total_matches}")
    print(f"   Similaritate medie: {avg_similarity:.4f} ({avg_similarity*100:.2f}%)")
    
    print(f"\n Detalii per imagine:")
    print("-" * 60)
    for orig_name, result in results.items():
        matches = result['exact_matches']
        avg_sim = result['avg_similarity']
        status = " Potriviri" if matches > 0 else " Fara potriviri"
        print(f"{status:20} {orig_name:30} ({matches} potriviri, avg: {avg_sim:.4f})")


if __name__ == "__main__":
    print("=" * 60)
    print(" COMPARATIE IMAGINI: Original vs Descarcate")
    print("=" * 60)
    
   
    results = compare_original_with_downloaded(
        original_folder="data/original",
        downloaded_folder="data/downloaded",
        similarity_threshold=0.60 
    )
    
    print_summary(results)
    

    output_file = 'image_comparison_results.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    
    print(f"\n Rezultatele detaliate au fost salvate in: {output_file}")

