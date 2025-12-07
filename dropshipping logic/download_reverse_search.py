
import os
import requests
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager
import base64
import time


def create_driver():
    """Setup Selenium WebDriver with Chrome"""
    options = webdriver.ChromeOptions()
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)
    return driver


def scroll_down(driver, scroll_pause_time=2, scroll_limit=10):
    """Scroll down to load more images"""
    last_height = driver.execute_script("return document.body.scrollHeight")
    for i in range(scroll_limit):
        driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
        time.sleep(scroll_pause_time)
        new_height = driver.execute_script("return document.body.scrollHeight")
        if new_height == last_height:
            break
        last_height = new_height


def scrape_all_images(driver):
    """Scrape all images from current page"""
    try:
        images = driver.find_elements(By.TAG_NAME, 'img')
        image_urls = []
        for img in images:
            image_url = img.get_attribute('src') or img.get_attribute('data-src')
            if image_url and "data:image/gif" not in image_url:
                width = int(img.get_attribute('width') or 0)
                height = int(img.get_attribute('height') or 0)
                if width >= 100 and height >= 100:
                    if image_url not in image_urls:
                        image_urls.append(image_url)
        return image_urls
    except Exception as e:
        print(f"Error scraping images: {e}")
        return []


def save_image(image_url, folder_name, file_name, retry_count=3):
    """Save image from URL"""
    try:
        file_path = os.path.join(folder_name, f"{file_name}.jpg")
        
        if image_url.startswith('data:image/'):
            # Handle base64 images
            header, encoded = image_url.split(',', 1)
            image_data = base64.b64decode(encoded)
            with open(file_path, 'wb') as f:
                f.write(image_data)
        else:
            # Handle regular URLs
            for attempt in range(retry_count):
                headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
                response = requests.get(image_url, headers=headers, timeout=10)
                if response.status_code == 200:
                    with open(file_path, 'wb') as f:
                        f.write(response.content)
                    break
                else:
                    print(f"Failed attempt {attempt+1} for image: {image_url}")
                    time.sleep(2)
        return file_path
    except Exception as e:
        print(f"Error saving image {file_name}: {e}")
        return None


def search_and_download_images(search_term, base_name, num_images=100, save_folder="data/downloaded"):
   
    if not os.path.exists(save_folder):
        os.makedirs(save_folder)
    
    print(f" Cautare: '{search_term}'")
    print(f" Salvare in: {save_folder}")
    print(f"Numar imagini: {num_images}")
    print(f" Nume fisiere: {base_name}_1.jpg, {base_name}_2.jpg, ...")
    print("-" * 60)
    
    driver = create_driver()
    
    try:
        # Navigate to Google Images search
        search_url = f"https://www.google.com/search?q={search_term}&tbm=isch"
        driver.get(search_url)
        time.sleep(5)
        
        # Scroll down to load more images
        scroll_down(driver, scroll_pause_time=2, scroll_limit=15)
        
        print("   Cautare...")
        # Scrape all images
        image_urls = scrape_all_images(driver)
        
        # Filter unique URLs
        unique_urls = []
        seen = set()
        for url in image_urls:
            if url and url not in seen:
                # Filter out Google UI elements
                if not any(x in url for x in ['logo', 'icon', 'button', 'gstatic.com/logo']):
                    if url.startswith('http') or url.startswith('data:image'):
                        unique_urls.append(url)
                        seen.add(url)
                        if len(unique_urls) >= num_images:
                            break
        
        print(f"   Gasite {len(unique_urls)} imagini, descarcare...")
        
        # Download images
        downloaded = 0
        for index, image_url in enumerate(unique_urls, start=1):
            file_name = f'{base_name}_{index}'
            saved_path = save_image(image_url, save_folder, file_name)
            
            if saved_path and os.path.exists(saved_path):
                downloaded += 1
                if downloaded % 10 == 0:
                    print(f"   Descarcate {downloaded}/{len(unique_urls)} imagini...")
        
        print(f"\n Finalizat! Descarcate {downloaded} imagini in {save_folder}")
        
    except Exception as e:
        print(f" Eroare: {e}")
    finally:
        driver.quit()


if __name__ == "__main__":

    search_term = "tomato"  
    base_name = "tomato"  
    num_images = 100 
    
    search_and_download_images(
        search_term=search_term,
        base_name=base_name,
        num_images=num_images,
        save_folder="data/downloaded"
    )
