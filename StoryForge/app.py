from flask import Flask, render_template, jsonify, request, send_from_directory
from flask import Response, stream_with_context
import storygen
import json
import os

app = Flask(__name__)

# --- FILE SERVING ---
@app.route('/character_images/<path:filename>')
def serve_char_image(filename):
    return send_from_directory('characters', filename)

# --- API ROUTES ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/load_data', methods=['GET'])
def load_initial_data():
    """Returns the full character list."""
    chars = storygen.merge_and_remap_characters()
    return jsonify({
        "characters": chars
    })

@app.route('/api/suggest', methods=['POST'])
def suggest_character():
    # 1. Check if the frontend provided a filtered list
    data = request.json
    if data and 'characters' in data and len(data['characters']) > 0:
        candidate_list = data['characters']
    else:
        # 2. Fallback: If list is empty or missing, re-scan the folder
        candidate_list = storygen.merge_and_remap_characters()
    
    # 3. Use the specific list for the suggestion
    suggestion = storygen.get_suggestion_api(candidate_list)
    return jsonify(suggestion)

@app.route('/api/generate-hooks', methods=['POST'])
def generate_hooks():
    data = request.json
    accepted_character = data.get('character')
    full_list = data.get('full_list')
    hook_count = data.get('hook_count', 5)
    temperature = data.get('temperature', 1.2)
    
    hooks = storygen.get_hooks_api(accepted_character, full_list, hook_count, temperature)
    return jsonify(hooks)

@app.route('/api/generate-outline', methods=['POST'])
def generate_outline():
    data = request.json
    hook_data = data.get('hook')
    protagonist = data.get('protagonist')
    full_list = data.get('full_list')
    story_format = data.get('story_format', 'Light Novel')
    temperature = data.get('temperature', 1.2)
    
    # --- FIX: Capture the slider values ---
    min_chapters = data.get('min_chapters', 10) # Default to 10 if missing
    max_chapters = data.get('max_chapters', 20)
    
    # Pass them to the function
    outline = storygen.get_outline_api(
        hook_data, protagonist, full_list, 
        story_format, temperature, 
        min_chapters, max_chapters
    )
    return jsonify(outline)

@app.route('/api/write-story', methods=['POST'])
def write_story():
    data = request.json
    outline = data.get('outline')
    
    # We use stream_with_context to keep the request active while the generator yields updates
    return Response(stream_with_context(storygen.generate_story_stream(outline)), 
                    mimetype='application/x-ndjson')

if __name__ == '__main__':
    app.run(debug=True, port=5001)