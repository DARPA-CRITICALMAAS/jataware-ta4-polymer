import uvicorn


def main():
    uvicorn.run("silk.http.api:api", host="0.0.0.0", port=3000, log_config="logging.yaml", root_path="", reload=True)


if __name__ == "__main__":
    main()
