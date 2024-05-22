import logging
from base64 import b64encode
from logging import Logger
from typing import List

import fitz
from langchain.vectorstores.chroma import Chroma
from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from openai import OpenAI

from ..settings import app_settings

logger: Logger = logging.getLogger(__name__)


client = OpenAI(
    api_key=app_settings.openai_api_key,
)

embeddings_model = OpenAIEmbeddings(api_key=app_settings.openai_api_key)


def getdb(doc_id: str):
    # TODO fix path
    db = Chroma(persist_directory=f"/tmp/db/{doc_id}", embedding_function=embeddings_model)
    return db


def parse(doc_id: str, pdf: fitz.Document):
    for page in pdf:
        yield Document(
            page_content=page.get_text(),
            metadata={"cdr_id": doc_id, "page": page.number}
            | {k: pdf.metadata[k] for k in pdf.metadata if type(pdf.metadata[k]) in [str, int]},
        )


def split_page(document: Document):
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=800,
        chunk_overlap=80,
        length_function=len,
        is_separator_regex=False,
    )
    docs = text_splitter.split_documents([document])
    for i, chunk in enumerate(docs):
        source = chunk.metadata.get("cdr_id", "")
        page = chunk.metadata.get("page", "")
        chunk_id = f"{source}:{page}:{i}"
        chunk.metadata["id"] = chunk_id
    return docs


def process_pdf(doc_id: str, pdf: fitz.Document) -> List[Document]:
    page_docs = parse(doc_id, pdf)
    chunked = [chunk for page in page_docs for chunk in split_page(page)]
    return chunked


def add_to_chroma(db, chunks: list[Document]):
    if len(chunks):
        logger.debug("Adding new documents: %d", len(chunks))
        chunk_ids = [chunk.metadata["id"] for chunk in chunks]
        db.add_documents(chunks, ids=chunk_ids)
        db.persist()


def search(db, text):
    results = db.similarity_search_with_score(text, k=5)
    return results


def gptit(pdf: fitz.Document):
    imgs = []

    for i in range(2):
        p = pdf[i]
        pix = p.get_pixmap(matrix=fitz.Matrix(4.0, 4.0))
        pix.tobytes()
        b64_img = b64encode(pix.tobytes()).decode("utf-8")

        imgs.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/png;base64,{b64_img}",
                },
            }
        )

    proompt = """

    Attached are the first 2 pages of a pdf please respond on each line in order with the `title` `author` and `year` of the document.
    Respond with a blank line if you cannot determine the value. Do not respond with anything other than the values

    """

    completion = client.chat.completions.create(
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": proompt,
                    },
                ]
                + imgs,
            }
        ],
        model="gpt-4-vision-preview",
        max_tokens=500,
    )

    return completion
