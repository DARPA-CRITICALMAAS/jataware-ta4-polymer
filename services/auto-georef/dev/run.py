import uvicorn


def main():
    uvicorn.run("auto_georef.http.api:api", host="0.0.0.0", port=3000, log_config="logging.yaml", reload=True)


if __name__ == "__main__":
    main()
