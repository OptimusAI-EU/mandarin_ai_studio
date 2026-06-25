# Mandarin AI Studio
## Overview 
This revised PRD is aimed at upgrading the Mandarin AI Studio to a full enterprise grade AI driven creative suite with following capabilities:
- Application Development:
    - Create full-stack web apps using the "Text" module
    - Create Android and ios apps using the "Text" module (later)
- Image Analysis:
    - Analyze images given an image or image url and text input yielding a text output describing the contents of image and related queries using the "Text" module. 
- Video Analysis:
    - Analyze videos given a video clip or video url and text input yielding a text output describing the contents of video and related queries using the "Text" module.
- Document Analysis: 
    - Process pdf documents given a pdf file or url and text input using the "Text" module
- Audio Analysis:
    - Analyze audio content given an audio file (url not supported) and text input and provide output in text using the "Text" module.
- Image Generation and Content Editing:
    - Generate images from text prompts (and optional reference images) using the "Image" module.
    - Edit images (content only) from text prompts and reference images using the "Image" module
- Video Generation:
    - Generate videos from text prompts (and optional reference images) using the "Video" module
- 
- Text to Speech (TTS):
    - Generate speech audio from text using "Speech" module (not the same as audio analysis which has a different API endpoit)
    - Important: Rename "Audio" module to "Speech" in order to avoid mixing it up with "Audio Analysis"
- Speech to Text (STT):
    - Transcribe speech into text using the "Speech" module
    - Important: Rename "Audio" module to "Speech" in order to avoid mixing it up with "Audio Analysis"

## API Endpoints and Requests:
Following urls explain the various API endpoints and how to formulate proper API requests (payloads) for aforementioned tasks:
- Important: You must go through the conternts of these urls and any further links provided on these pages in order to properly formulate API requests:
    # Overview (Multimodal): https://openrouter.ai/docs/guides/overview/multimodal/overview
    # Image Analysis: https://openrouter.ai/docs/guides/overview/multimodal/image-understanding
    # Video Analysis: https://openrouter.ai/docs/guides/overview/multimodal/videos
    # Document Analysis: https://openrouter.ai/docs/guides/overview/multimodal/pdfs
    # Image Generation and Editing: https://openrouter.ai/docs/guides/overview/multimodal/image-generation#model-discovery
    # Video Generation: https://openrouter.ai/docs/guides/overview/multimodal/video-generation
    # Text to Speech:  https://openrouter.ai/docs/guides/overview/multimodal/tts
    # Speech to Text: https://openrouter.ai/docs/guides/overview/multimodal/stt


    
