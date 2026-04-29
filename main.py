# Semantic search part inspired by 
# "Build a semantic search engine with LangChain" tutorial 
# (https://docs.langchain.com/oss/python/langchain/knowledge-base)

import os
import hashlib
import numpy as np

from dotenv import load_dotenv
from langchain_community.document_loaders import PyPDFLoader
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_chroma import Chroma
from sentence_transformers import CrossEncoder


def load_pdf(file_path):    
    # PyPDFLoader loads one Document object per PDF page
    loader = PyPDFLoader(file_path)
    documents = loader.load()
    return documents


def split_documents(documents, chunk_size, chunk_overlap, add_start_index):
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size, chunk_overlap=chunk_overlap, add_start_index=add_start_index
    )
    all_splits = text_splitter.split_documents(documents)

    return all_splits


def create_vectorstore_from_chunks(collection_name, embedding_function, persist_directory, chunks):
    # instantiate vector store
    vector_store = Chroma(
        collection_name=collection_name,
        embedding_function=embedding_function,
        persist_directory=persist_directory,
    )

    # index the documents
    document_ids = [deterministic_chunk_id(chunk) for chunk in chunks]
    vector_store.add_documents(documents=chunks, ids=document_ids)

    return vector_store, document_ids


def deterministic_chunk_id(document):
    metadata = document.metadata or {}
    source = metadata.get("source", "unknown_source")
    page = metadata.get("page", "unknown_page")
    start_index = metadata.get("start_index", "unknown_start")

    id_seed = f"{source}|{page}|{start_index}"
    # Keep IDs stable even if metadata is missing or duplicated.
    if "unknown_" in id_seed:
        content_hash = hashlib.sha256(document.page_content.encode("utf-8")).hexdigest()[:16]
        id_seed = f"{id_seed}|{content_hash}"

    return hashlib.sha256(id_seed.encode("utf-8")).hexdigest()


def get_embedding_function(openai_model_name="text-embedding-3-large"):
    embeddings = OpenAIEmbeddings(model=openai_model_name)

    vector_1 = embeddings.embed_query("first chunk")
    vector_2 = embeddings.embed_query("This is another chunk")

    assert len(vector_1) == len(vector_2)
    print(f"Generated vectors of length {len(vector_1)}\n")

    return embeddings


def get_query_from_user():
    query = input("Please enter your query: ")
    return query


def query_candidate_chunks_from_vectorstore(vector_store, num_candidates, query):
    base_retriever = vector_store.as_retriever(
        search_type="similarity",
        search_kwargs={"k" : num_candidates} # initial candidate pool
    )

    candidate_chunks = base_retriever.invoke(query)
    return candidate_chunks


def create_sentence_pairs(query, candidate_chunks):
    sentence_pairs = []

    print(f"\nCandidate chunks ({len(candidate_chunks)}):")
    for candidate_chunk in candidate_chunks:
        print()
        print(f"chunk id: {candidate_chunk.id}")
        print(candidate_chunk.page_content)

        sentence_pairs.append([query, candidate_chunk.page_content])
        print()
        print("-" * 50)

    return sentence_pairs


def rerank_pairs(cross_encoder_model_name, sentence_pairs):
    cross_encoder_model = CrossEncoder(cross_encoder_model_name)
    scores = cross_encoder_model.predict(sentence_pairs)

    print(f"\nScores: {scores}")

    sorted_idx = np.argsort(scores)[::-1]
    print(f"\nSorted indices: {sorted_idx}")
    
    sorted_scores = scores[sorted_idx]
    print(f"\nSorted scores: {sorted_scores}")

    return sorted_idx, sorted_scores


def main():

    # size of initial set of retrieved chunks
    k = 10

    print("Hello from rag-system!\n")

    # Load environment variables
    load_dotenv()
    if not os.getenv("OPENAI_API_KEY"):
        raise RuntimeError("OPENAI_API_KEY is not set. Add it to your " \
            "environment .env file.")


    ###################################################
    ########            1. INDEXING            ########
    ###################################################
    print("[ ] Indexing documents...")

    # 1.1 Load documents
    file_path = "./pdf_documents/GPT-4 Technical Report (small 3 pages).pdf"
    docs = load_pdf(file_path)
    print(f"Number of pages in {file_path.split("/")[-1]}: {len(docs)}")

    # 1.2 Split our documents into chunks
    all_splits = split_documents(docs, chunk_size=500, chunk_overlap=100, add_start_index=True)
    print(f"Number of splits in {file_path.split("/")[-1]}: {len(all_splits)}")

    # 1.3 Get embeddings function
    embeddings = get_embedding_function(openai_model_name="text-embedding-3-large")

    # 1.4 Create Vector Store
    vector_store, document_ids = create_vectorstore_from_chunks(
        collection_name="documents_collection", 
        embedding_function=embeddings, 
        persist_directory= "./chroma_langchain_db",
        chunks=all_splits)


    ###################################################
    ########           2. RAG CHAIN            ########
    ###################################################
    print("[ ] Retrieval Augmented Generation...")

    # 2.1 Get query from user
    query = get_query_from_user()

    # 2.2 vector based semantic search
    candidate_chunks = query_candidate_chunks_from_vectorstore(
        vector_store=vector_store, 
        num_candidates=k, 
        query=query)
    
    # 2.3 Re-rank using Cross-Encoders for sentence pair scoring
    sentence_pairs = create_sentence_pairs(query, candidate_chunks)
    sorted_idx, _ = rerank_pairs("cross-encoder/ms-marco-MiniLM-L6-v2", sentence_pairs)

    # 2.3 Print results
    print(f"\nTop 3 results:\n")
    for i, idx in enumerate(sorted_idx[:3]):
        print("-" * 50)
        print(f"\nRanking: {i+1}")
        print(f"Source: {candidate_chunks[idx].metadata['source']}")
        print(f"Page: {candidate_chunks[idx].metadata['page']}")
        print(f"\nContent: \n{candidate_chunks[idx].page_content}\n")


if __name__ == "__main__":
    main()
