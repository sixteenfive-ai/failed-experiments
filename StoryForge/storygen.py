import os
import json
import time
import uuid
import datetime
from google import genai
from google.genai import types
import re
import datetime

# --- CONFIGURATION ---
MODEL_ID = "gemini-2.0-flash"
KEY_FILE = "geminikey.txt"
CHARACTERS_DIR = "characters"
CHARACTERS_JSON_PATH = os.path.join(CHARACTERS_DIR, "characters.json")
PROMPTS_DIR = "prompts"
LOG_FILE = "llm_logs.txt"

SAFETY_SETTINGS = [
    types.SafetySetting(category="HARM_CATEGORY_HATE_SPEECH", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_DANGEROUS_CONTENT", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold="BLOCK_NONE"),
    types.SafetySetting(category="HARM_CATEGORY_HARASSMENT", threshold="BLOCK_NONE")
]

# Mapping: "Legacy Key" -> "Modern Key"
FIELD_MAPPING = {
    "name": "full_name",
    "species": "species",
    "description": "visual_description",
    "personality": "personality",
    "backstory": "biography",
    "skills": "proficiencies",
    "immutables": "fixed_attributes",
    "outfit": "signature_outfit"
}

# --- UTILITIES ---
def load_gemini_key():
    try:
        with open(KEY_FILE, "r") as f:
            return f.read().strip()
    except FileNotFoundError:
        return None

def load_prompt(filename):
    path = os.path.join(PROMPTS_DIR, filename)
    try:
        with open(path, "r", encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        return None

def log_interaction(prompt, response):
    try:
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(f"\n{'='*60}\n")
            f.write(f"TIMESTAMP: {timestamp}\n")
            f.write(f"{'-'*60}\n")
            f.write(f"--- PROMPT ---\n{prompt}\n")
            f.write(f"{'-'*60}\n")
            f.write(f"--- RESPONSE ---\n{response}\n")
            f.write(f"{'='*60}\n")
    except Exception as e:
        print(f"Failed to write logs: {e}")

def merge_and_remap_characters():
    merged_data = []
    if not os.path.exists(CHARACTERS_DIR): return None

    for folder_name in os.listdir(CHARACTERS_DIR):
        folder_path = os.path.join(CHARACTERS_DIR, folder_name)
        if not os.path.isdir(folder_path): continue

        json_path = None
        for file_name in os.listdir(folder_path):
            if file_name.endswith(".json") and file_name != "characters.json":
                json_path = os.path.join(folder_path, file_name)
                break 

        if json_path:
            try:
                with open(json_path, 'r', encoding='utf-8') as f:
                    source_data = json.load(f)
                
                # --- FIXED MAPPING LOGIC (Smart Check) ---
                remapped_char = {}
                
                for old_key, new_key in FIELD_MAPPING.items():
                    # 1. Check if the file already has the modern key (e.g. 'full_name')
                    if new_key in source_data:
                        remapped_char[new_key] = source_data[new_key]
                    # 2. Fallback to the legacy key (e.g. 'name')
                    elif old_key in source_data:
                        remapped_char[new_key] = source_data[old_key]
                    else:
                        remapped_char[new_key] = "" # Default to empty string to prevent errors

                # 3. Handle Images
                raw_images = source_data.get("generated_images", {})
                clean_images = {}
                known_paths = set()
                
                # Copy existing image objects
                for key, val in raw_images.items():
                    if isinstance(val, dict) and "path" in val:
                        clean_images[key] = val
                        known_paths.add(val["path"].replace("\\", "/"))

                # Add strings if not duplicates
                for key, val in raw_images.items():
                    if isinstance(val, str):
                        normalized_path = val.replace("\\", "/")
                        if normalized_path not in known_paths:
                            clean_images[key] = normalized_path
                            known_paths.add(normalized_path)
                
                remapped_char["generated_images"] = clean_images
                merged_data.append(remapped_char)
                
            except Exception as e:
                print(f"Error processing {folder_name}: {e}")
                continue

    # Write the fresh file
    try:
        with open(CHARACTERS_JSON_PATH, 'w', encoding='utf-8') as out_f:
            json.dump(merged_data, out_f, indent=4)
    except:
        pass
    
    return merged_data

# --- LLM ENGINE ---
def run_llm_step(client, prompt_text, context, input_keys, temperature=1.2, ensure_json=False):
    seed_guid = str(uuid.uuid4())
    final_prompt = f"SEED: {seed_guid}\n\n{prompt_text}"
    for key in input_keys:
        value = str(context.get(key, ""))
        final_prompt = final_prompt.replace(f"<{key}>", value).replace(f"{{{key}}}", value)

    config = types.GenerateContentConfig(
        temperature=temperature,
        response_mime_type="application/json" if ensure_json else "text/plain",
        safety_settings=SAFETY_SETTINGS
    )
    
    for _ in range(3):
        try:
            response = client.models.generate_content(model=MODEL_ID, contents=final_prompt, config=config)
            result_text = response.text.strip()
            
            log_interaction(final_prompt, result_text)
            
            if ensure_json and result_text.startswith("```"):
                result_text = result_text.replace("```json", "").replace("```", "").strip()
            data = json.loads(result_text) if ensure_json else result_text
            if ensure_json and isinstance(data, list) and len(data) > 0: return data[0]
            return data
        except: time.sleep(1)
    return {} if ensure_json else ""

# --- DATA CLEANING ---
def sanitize_for_llm(character_list, trim_visuals=False):
    clean_list = []
    for char in character_list:
        clean_char = char.copy()
        if "generated_images" in clean_char: del clean_char["generated_images"]
        if trim_visuals and "visual_description" in clean_char: del clean_char["visual_description"]
        clean_list.append(clean_char)
    return clean_list

# --- API HELPERS ---
def get_suggestion_api(character_list):
    api_key = load_gemini_key()
    client = genai.Client(api_key=api_key)
    prompt = load_prompt("suggest_character.txt")
    clean_list = sanitize_for_llm(character_list, trim_visuals=False)
    context = {"character_data": json.dumps(clean_list, indent=2)}
    return run_llm_step(client, prompt, context, ["character_data"], ensure_json=True)

def get_hooks_api(accepted_character, full_list, hook_count=5, temperature=1.2):
    api_key = load_gemini_key()
    client = genai.Client(api_key=api_key)
    prompt = load_prompt("generate_hooks.txt")
    
    clean_protagonist = accepted_character.copy()
    if "generated_images" in clean_protagonist: del clean_protagonist["generated_images"]
    if "visual_description" in clean_protagonist: del clean_protagonist["visual_description"]
        
    clean_world = sanitize_for_llm(full_list, trim_visuals=True)
    
    context = {
        "character_json": json.dumps(clean_protagonist, indent=2),
        "world_characters": json.dumps(clean_world, indent=2),
        "hook_count": str(hook_count)
    }
    
    return run_llm_step(client, prompt, context, ["character_json", "world_characters", "hook_count"], temperature=temperature, ensure_json=True)

def get_outline_api(hook_data, protagonist, full_list, story_format="Light Novel", temperature=1.2, min_chapters=6, max_chapters=12):
    api_key = load_gemini_key()
    client = genai.Client(api_key=api_key)
    
    prompt_file = "generate_ln_outline.txt" 
    prompt = load_prompt(prompt_file)

    clean_protagonist = protagonist.copy()
    if "generated_images" in clean_protagonist: del clean_protagonist["generated_images"]
    
    clean_world = sanitize_for_llm(full_list, trim_visuals=False)

    context = {
        "story_format": story_format,
        "hook_title": hook_data.get("title", ""),
        "hook_idea": hook_data.get("idea", ""),
        "hook_tone": hook_data.get("tone", ""),
        "character_json": json.dumps(clean_protagonist, indent=2),
        "world_characters": json.dumps(clean_world, indent=2),
        "min_chapters": str(min_chapters),
        "max_chapters": str(max_chapters)
    }
    
    keys = ["story_format", "hook_title", "hook_idea", "hook_tone", "character_json", "world_characters", "min_chapters", "max_chapters"]
    
    return run_llm_step(client, prompt, context, keys, temperature=temperature, ensure_json=True)


def generate_story_stream(outline_data):
    api_key = load_gemini_key()
    client = genai.Client(api_key=api_key)

    # 1. Setup Directories
    title_safe = "".join([c for c in outline_data.get('title', 'Untitled') if c.isalpha() or c.isdigit() or c==' ']).strip()
    story_dir = os.path.join("stories", title_safe)
    os.makedirs(story_dir, exist_ok=True)
    os.makedirs("logs", exist_ok=True)

    # Save Initial Outline
    with open(os.path.join(story_dir, "00_Raw_Outline.json"), "w", encoding="utf-8") as f:
        json.dump(outline_data, f, indent=4)

    # --- STEP 1: ENRICH CHARACTERS (The "Voice" Upgrade) ---
    cast_profiles = outline_data.get('cast_profiles', {})
    # If cast_profiles is missing (legacy outline), try to build it from 'selected_side_characters' 
    # (Implementation omitted for brevity, but assume cast_profiles exists from get_outline_api)

    enriched_cast = {}
    total_cast = len(cast_profiles)
    
    for idx, (name, profile) in enumerate(cast_profiles.items()):
        yield json.dumps({"status": f"Developing Psychology: {name}...", "progress": (idx / total_cast) * 10}) + "\n"
        
        enrich_prompt = load_prompt("lightnovel/enrich_character.txt")
        context = {
            "name": name,
            "json_data": json.dumps(profile),
            "role": "Protagonist" if name == outline_data.get('protagonist_arc') else "Supporting" 
        }
        
        voice_data = run_llm_step(client, enrich_prompt, context, ["name", "json_data", "role"], temperature=1.0, ensure_json=True)
        
        # Merge voice data into profile
        profile['voice_profile'] = voice_data.get('voice_profile', {})
        enriched_cast[name] = profile

    # Save Enriched Cast
    with open(os.path.join(story_dir, "01_Cast_Psychology.json"), "w", encoding="utf-8") as f:
        json.dump(enriched_cast, f, indent=4)

    # --- STEP 2: DEVELOP STORY BIBLE (The "Complex Plan") ---
    yield json.dumps({"status": "Architecting Story Bible (This may take a moment)...", "progress": 15}) + "\n"
    
    bible_prompt = load_prompt("lightnovel/develop_story_bible.txt")
    target_scenes_total = 60 # Aim for density
    
    bible_context = {
        "outline_json": json.dumps(outline_data['outline']),
        "cast_json": json.dumps(enriched_cast),
        "target_scene_count": str(target_scenes_total)
    }
    
    story_bible = run_llm_step(client, bible_prompt, bible_context, ["outline_json", "cast_json", "target_scene_count"], temperature=1.0, ensure_json=True)
    
    # Save Bible
    with open(os.path.join(story_dir, "02_Story_Bible.json"), "w", encoding="utf-8") as f:
        json.dump(story_bible, f, indent=4)

    # --- STEP 3: THE WRITING LOOP (Using the Bible) ---
    chapters_plan = story_bible.get('chapter_plans', [])
    total_chapters = len(chapters_plan)
    
    story_so_far = "The story begins."
    current_memory = "No shared history yet."
    last_chapter_summary = "N/A"

    for i, chap_plan in enumerate(chapters_plan):
        chap_num = chap_plan.get('chapter_number', i+1)
        scenes = chap_plan.get('scenes', [])
        
        full_chapter_text = ""
        
        for s_idx, scene in enumerate(scenes):
            # Progress Math (Starts at 20%, ends at 100%)
            total_progress = 20 + ((i / total_chapters) * 80) + ((s_idx / len(scenes)) * (80 / total_chapters))
            
            pov_name = scene.get('pov_character', 'Protagonist')
            pov_data = enriched_cast.get(pov_name, {})
            voice_json = json.dumps(pov_data.get('voice_profile', {}), indent=2)

            yield json.dumps({"status": f"Writing Ch {chap_num}: Scene {scene.get('scene_num')} ({pov_name})...", "progress": total_progress}) + "\n"
            
            # Select Prompt
            prompt_file = "lightnovel/write_ln_middle_chapter.txt"
            if i == 0 and s_idx == 0: prompt_file = "lightnovel/write_ln_intro_chapter.txt"
            elif i == total_chapters - 1 and s_idx == len(scenes) - 1: prompt_file = "lightnovel/write_ln_resolution_chapter.txt"
            
            base_prompt = load_prompt(prompt_file)
            
            # Build Context
            ctx = f"""
            POV CHARACTER: {pov_name}
            POV VOICE PROFILE: {voice_json}
            
            SCENE CONTEXT:
            Location: {scene.get('location')}
            Action: {scene.get('plot_beat')}
            Internal Shift: {scene.get('emotional_beat')}
            Subplot: {scene.get('subplot_thread', 'None')}
            
            STORY SO FAR: {story_so_far}
            MEMORY: {current_memory}
            """
            
            if full_chapter_text:
                 ctx += f"\n\nIMMEDIATE CONTEXT:\n...{full_chapter_text[-2000:]}"
            
            # Run LLM
            prompt_text = base_prompt.replace("<context>", ctx).replace("<story_format>", "Light Novel")
            # Inject voice profile logic into prompt tags if needed
            prompt_text = prompt_text.replace("<pov_name>", pov_name).replace("<voice_json>", voice_json)
            prompt_text = prompt_text.replace("<location>", scene.get('location', '')).replace("<plot_beat>", scene.get('plot_beat', '')).replace("<emotional_beat>", scene.get('emotional_beat', ''))
            prompt_text = prompt_text.replace("<story_so_far>", story_so_far).replace("<memory>", current_memory)

            scene_text = run_llm_step(client, prompt_text, {}, [], temperature=1.3)
            full_chapter_text += f"\n\n{scene_text}"

        # Save Chapter
        with open(os.path.join(story_dir, f"Chapter_{chap_num}.txt"), "w", encoding="utf-8") as f:
            f.write(full_chapter_text)

        yield json.dumps({"status": f"Summarizing Chapter {chap_num}...", "progress": ((i + 0.9) / total_chapters) * 100}) + "\n"
        
        summ_prompt = load_prompt("lightnovel/summarize_chapter.txt").replace("<chapter_full_text>", full_chapter_text)
        last_chapter_summary = run_llm_step(client, summ_prompt, {}, [], temperature=1.0)
        
        mem_prompt = load_prompt("lightnovel/update_memory.txt")
        mem_prompt = mem_prompt.replace("<existing_memory_list>", current_memory)
        mem_prompt = mem_prompt.replace("<chapter_full_text>", full_chapter_text)
        current_memory = run_llm_step(client, mem_prompt, {}, [], temperature=1.0)

        ssf_prompt = load_prompt("lightnovel/story_so_far.txt")
        ssf_prompt = ssf_prompt.replace("<full_story_summary>", story_so_far)
        ssf_prompt = ssf_prompt.replace("<chapter_summary>", last_chapter_summary)
        story_so_far = run_llm_step(client, ssf_prompt, {}, [], temperature=1.0)
        
        with open(os.path.join(story_dir, "00_State_Log.txt"), "a", encoding="utf-8") as f:
            f.write(f"\n--- AFTER CHAPTER {chap_num} ---\nMEMORY:\n{current_memory}\n\nSTORY SO FAR:\n{story_so_far}\n")

    yield json.dumps({"status": "Story Complete!", "progress": 100, "complete": True, "path": story_dir}) + "\n"