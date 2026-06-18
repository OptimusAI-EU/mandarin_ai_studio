#Mandarin AI Studio
## Backend
-  Model page does not retrieve all models from openrouter. Only 14 models are retrieved which are video generating models but shown under the category "unknown". All models from openrouter should be retrieved and shown under their correct categories i.e. text/multimodal (should be one category as it is difficult to distinguish multimodal models from text models), 3D, video, audio and image.
- Dropdown on the models page should include all the above categories plus "All Modalities" and "others". Currently only "All Modalities" and "unknown" are being displayed. "Unknown" should be removed and replaced by "others". Clicking a category should display models of only that category except for "All Modalities" which should show all models under their respective categories.
- Models should be selected also from the "Models" page in addition to the dropdown from the various modules' pages as at present.
- On the Models page the procedure for selecting a model should be as under:
- Hovering over a model-card or clicking on it should open a modal with the option to select that model. 
- All the links to model pages on openrouter are currentlly broken and lead to a 404 error.
- Also provide a "search" functionality so the one can search for and select a certain model.
## Frontend
- Replace the name of the gallery page with "Artifacts", it should be the page where one can see the results of conversations including code, images, videos, audios etc. The save button is currently not working. It should be functional in case the user wants to save a certain artifact to their machine. Remove the "compare" button as it is not needed.
- Replace the name of the jobs page with "Sessions", it should contain links to all previous chat sessions. Remove the "compare" button from here and make the functionality of "save" button. Clicking on any chat session should open it in the main UI.
- On the Create page sidebar replace the names of the links with the amended names as above. The sessions link should open links to past chats clicking on which should open it in the main chat page.
- Just make one unified chat page instead of 5 separate links accessible from the navbar. All kind of operations including text, audio, video, image and 3D etc. should be conducted from this single page not different pages
- Currently the chat in the main widget is being duplicated in the right side-bar. This should be corrected and the right side bar should be just an html preview pane where one can see various artifacts such as code, images, videos etc. during/after conversation.
- The attach tab in the main text-area should be able to upload files, folders, images, urls, audio etc. to the context of the conversation.